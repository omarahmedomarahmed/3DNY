import { SalesforceError, runQuery, type SalesforceConfig } from '@/lib/salesforce';

/**
 * Reading Salesforce **reports**, as opposed to querying objects.
 *
 * A leasing team does not think in SOQL. It thinks in the report it already
 * maintains — "Available Spaces – NYC", the one it opens every Monday. That
 * report is where the truth lives, somebody already curated its filters, and
 * it changes when the market changes. So the integration binds to a report and
 * follows it, rather than asking anyone to describe their schema.
 *
 * Three calls make that work:
 *
 *   listReports    everything the run-as user can see, so it can be picked
 *   describeReport its columns, so they can be mapped to ours
 *   runReport      its rows today, which is the whole point
 *
 * **The 2,000-row ceiling is the thing to know.** The Analytics API returns at
 * most 2,000 detail rows and sets `allData: false` when it truncated. That is
 * survivable for a preview and dangerous for a sync: a 2,400-row availability
 * report would import 2,000 and then retire the 400 it never saw. So
 * `runReport` reports truncation as data rather than swallowing it, and the
 * sync refuses to retire anything when it is set.
 */

const API = 'v60.0';
const LIST_TIMEOUT_MS = 20_000;
const RUN_TIMEOUT_MS = 120_000;

/** The Analytics API's hard ceiling on detail rows in one response. */
export const REPORT_ROW_LIMIT = 2000;

export interface ReportSummary {
  id: string;
  name: string;
  developerName: string | null;
  folder: string | null;
  format: string | null;
  lastRunAt: string | null;
}

export interface ReportColumn {
  /** The API name, e.g. `Account.Name` — what the mapping is keyed on. */
  name: string;
  /** What a person sees in Salesforce, e.g. "Account Name". */
  label: string;
  dataType: string | null;
}

export interface ReportData {
  id: string;
  name: string;
  format: string | null;
  columns: ReportColumn[];
  /** One object per detail row, keyed by column API name. */
  rows: Record<string, string>[];
  /**
   * False when Salesforce truncated at 2,000 rows. A sync must not retire
   * anything on a truncated read — the rows it did not see are not gone.
   */
  complete: boolean;
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(
  config: SalesforceConfig,
  token: string,
  path: string,
  timeoutMs: number,
  whatFailed: string,
): Promise<T> {
  const res = await withTimeout(timeoutMs, (signal) =>
    fetch(`${config.instanceUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    }),
  ).catch((err: Error) => {
    throw new SalesforceError(
      `${whatFailed} (${err.message}).`,
      'Retry. If it keeps happening, export the report as CSV and use the import page — ' +
        'that path produces the same result.',
    );
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 400);
    throw new SalesforceError(
      `${whatFailed} — Salesforce returned ${res.status}. ${detail}`,
      res.status === 403 || res.status === 404
        ? 'The connected app’s run-as user cannot see this report. Share the report’s folder ' +
          'with that user in Salesforce, then try again.'
        : 'Check the report still exists and has not been renamed or deleted.',
      res.status,
    );
  }
  return (await res.json()) as T;
}

/**
 * Every report the run-as user can see.
 *
 * Deliberately SOQL against the `Report` object rather than the Analytics
 * API's own list endpoint: that endpoint returns only *recently viewed*
 * reports, capped at 200, which means the report somebody wants would often
 * simply not be in the list and there would be no way to tell why.
 */
export async function listReports(
  config: SalesforceConfig,
  token: string,
): Promise<ReportSummary[]> {
  const records = await runQuery(
    config,
    token,
    'SELECT Id, Name, DeveloperName, FolderName, Format, LastRunDate ' +
      'FROM Report ORDER BY FolderName NULLS LAST, Name LIMIT 2000',
  );

  return records.map((r) => ({
    id: String(r.Id ?? ''),
    name: String(r.Name ?? '(unnamed report)'),
    developerName: r.DeveloperName ? String(r.DeveloperName) : null,
    folder: r.FolderName ? String(r.FolderName) : null,
    format: r.Format ? String(r.Format) : null,
    lastRunAt: r.LastRunDate ? String(r.LastRunDate) : null,
  }));
}

interface DescribeResponse {
  reportMetadata?: {
    name?: string;
    reportFormat?: string;
    detailColumns?: string[];
  };
  reportExtendedMetadata?: {
    detailColumnInfo?: Record<string, { label?: string; dataType?: string }>;
  };
}

/** A report's detail columns, in the order Salesforce lists them. */
export function columnsFrom(body: DescribeResponse | RunResponse): ReportColumn[] {
  const order = body.reportMetadata?.detailColumns ?? [];
  const info = body.reportExtendedMetadata?.detailColumnInfo ?? {};
  const names = order.length > 0 ? order : Object.keys(info);
  return names.map((name) => ({
    name,
    label: info[name]?.label ?? name,
    dataType: info[name]?.dataType ?? null,
  }));
}

export async function describeReport(
  config: SalesforceConfig,
  token: string,
  reportId: string,
): Promise<{ name: string; format: string | null; columns: ReportColumn[] }> {
  const body = await getJson<DescribeResponse>(
    config,
    token,
    `/services/data/${API}/analytics/reports/${encodeURIComponent(reportId)}/describe`,
    LIST_TIMEOUT_MS,
    'Could not read the report’s columns',
  );
  return {
    name: body.reportMetadata?.name ?? reportId,
    format: body.reportMetadata?.reportFormat ?? null,
    columns: columnsFrom(body),
  };
}

interface RunResponse {
  reportMetadata?: DescribeResponse['reportMetadata'];
  reportExtendedMetadata?: DescribeResponse['reportExtendedMetadata'];
  factMap?: Record<string, { rows?: { dataCells?: { label?: unknown; value?: unknown }[] }[] }>;
  allData?: boolean;
}

/**
 * Detail rows out of a report response.
 *
 * Salesforce returns rows inside a `factMap` keyed by grouping — `"T!T"` for a
 * tabular report, `"0!T"`, `"1!T"` and so on once the report has groupings.
 * Every detail row appears in exactly one bucket, so concatenating all of them
 * is correct for tabular, summary and matrix alike, and means a team that
 * grouped their availability report by submarket does not have to ungroup it.
 *
 * Cells are read by `label` rather than `value`: the label is what Salesforce
 * shows a person, already formatted — "12,500", "5/31/2027", "Direct" — and
 * that is what our own parsers were written against. `value` carries raw
 * internals like record ids and epoch millis.
 */
export function rowsFrom(body: RunResponse, columns: ReportColumn[]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const bucket of Object.values(body.factMap ?? {})) {
    for (const row of bucket.rows ?? []) {
      const cells = row.dataCells ?? [];
      const record: Record<string, string> = {};
      columns.forEach((column, i) => {
        const cell = cells[i];
        if (!cell) return;
        const raw = cell.label ?? cell.value;
        // Salesforce writes an empty cell as the literal "-", which would
        // otherwise sail through every "is it blank" check downstream.
        const text = raw == null ? '' : String(raw).trim();
        record[column.name] = text === '-' ? '' : text;
      });
      out.push(record);
    }
  }
  return out;
}

export async function runReport(
  config: SalesforceConfig,
  token: string,
  reportId: string,
): Promise<ReportData> {
  const body = await getJson<RunResponse>(
    config,
    token,
    `/services/data/${API}/analytics/reports/${encodeURIComponent(reportId)}?includeDetails=true`,
    RUN_TIMEOUT_MS,
    'Could not run the report',
  );

  const columns = columnsFrom(body);
  const rows = rowsFrom(body, columns);

  return {
    id: reportId,
    name: body.reportMetadata?.name ?? reportId,
    format: body.reportMetadata?.reportFormat ?? null,
    columns,
    rows,
    // `allData` is the authority; the row count is a backstop for the case
    // where an older API version omits the flag entirely.
    complete: body.allData !== false && rows.length < REPORT_ROW_LIMIT,
  };
}
