import { sql } from '@/lib/db';
import type { FeedKind } from '@/lib/salesforce-mapping';

/**
 * Which Salesforce report feeds what, and what each sync did.
 *
 * The binding is chosen once on the setup page and lives here rather than in an
 * environment variable, because the whole point is that a leasing lead can
 * repoint a feed at a different report without a redeploy. Credentials stay in
 * the environment; only "which report, and which column is which" is stored.
 */

export const FEED_KINDS = ['spaces', 'occupiers', 'clients'] as const;

export const FEED_LABELS: Record<FeedKind, string> = {
  spaces: 'Available spaces',
  occupiers: 'Occupiers',
  clients: 'Cresa clients',
};

export interface Feed {
  kind: FeedKind;
  report_id: string;
  report_name: string;
  report_folder: string | null;
  column_map: Record<string, string>;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  updated_at: string;
}

export interface FeedRun {
  id: string;
  kind: FeedKind;
  report_name: string | null;
  started_at: string;
  finished_at: string | null;
  status: 'ok' | 'failed' | 'partial';
  trigger: 'manual' | 'daily';
  rows_read: number;
  added: number;
  updated: number;
  retired: number;
  skipped: number;
  detail: RunDetail;
  error: string | null;
}

/**
 * What actually changed, not a count of it.
 *
 * "Retired 40" is not something anyone can check. Forty addresses is — and a
 * broker who notices one of them should not have been retired can say so
 * before it costs a meeting.
 */
export interface RunDetail {
  retiredSpaces?: { address: string; floor: string }[];
  unresolved?: { address: string; company?: string; reason: string }[];
  skippedRows?: { row: number; reason: string }[];
  /** Set when Salesforce truncated the report, which suppresses retirement. */
  truncated?: boolean;
  note?: string;
}

function toFeed(row: Record<string, unknown>): Feed {
  return {
    kind: row.kind as FeedKind,
    report_id: String(row.report_id),
    report_name: String(row.report_name),
    report_folder: (row.report_folder as string | null) ?? null,
    column_map: (row.column_map as Record<string, string>) ?? {},
    enabled: Boolean(row.enabled),
    last_run_at: (row.last_run_at as string | null) ?? null,
    last_status: (row.last_status as string | null) ?? null,
    updated_at: String(row.updated_at),
  };
}

export async function getFeeds(): Promise<Feed[]> {
  const rows = (await sql()`
    SELECT * FROM salesforce_feeds ORDER BY kind`) as Record<string, unknown>[];
  return rows.map(toFeed);
}

export async function getFeed(kind: FeedKind): Promise<Feed | null> {
  const rows = (await sql()`
    SELECT * FROM salesforce_feeds WHERE kind = ${kind}`) as Record<string, unknown>[];
  return rows[0] ? toFeed(rows[0]) : null;
}

/** Bind a feed to a report, or repoint one that is already bound. */
export async function saveFeed(input: {
  kind: FeedKind;
  reportId: string;
  reportName: string;
  reportFolder?: string | null;
  columnMap: Record<string, string>;
  enabled?: boolean;
}): Promise<Feed> {
  // Drop empty selections rather than storing them: a blank string would read
  // as "mapped to a column named nothing" everywhere downstream.
  const map = Object.fromEntries(
    Object.entries(input.columnMap).filter(([, v]) => typeof v === 'string' && v.trim() !== ''),
  );

  const rows = (await sql()`
    INSERT INTO salesforce_feeds (kind, report_id, report_name, report_folder, column_map, enabled)
    VALUES (${input.kind}, ${input.reportId}, ${input.reportName},
            ${input.reportFolder ?? null}, ${JSON.stringify(map)}::jsonb,
            ${input.enabled ?? true})
    ON CONFLICT (kind) DO UPDATE SET
      report_id     = EXCLUDED.report_id,
      report_name   = EXCLUDED.report_name,
      report_folder = EXCLUDED.report_folder,
      column_map    = EXCLUDED.column_map,
      enabled       = EXCLUDED.enabled,
      updated_at    = now()
    RETURNING *`) as Record<string, unknown>[];
  return toFeed(rows[0]);
}

/** Unbind. The map keeps whatever the feed already wrote; nothing is deleted. */
export async function deleteFeed(kind: FeedKind): Promise<void> {
  await sql()`DELETE FROM salesforce_feeds WHERE kind = ${kind}`;
}

export async function startRun(input: {
  kind: FeedKind;
  reportId: string;
  reportName: string;
  trigger: 'manual' | 'daily';
}): Promise<string> {
  const rows = (await sql()`
    INSERT INTO salesforce_runs (kind, report_id, report_name, trigger)
    VALUES (${input.kind}, ${input.reportId}, ${input.reportName}, ${input.trigger})
    RETURNING id`) as { id: string }[];
  return rows[0].id;
}

export async function finishRun(
  id: string,
  result: {
    status: 'ok' | 'failed' | 'partial';
    rowsRead?: number;
    added?: number;
    updated?: number;
    retired?: number;
    skipped?: number;
    detail?: RunDetail;
    error?: string | null;
  },
): Promise<void> {
  const db = sql();
  await db`
    UPDATE salesforce_runs SET
      finished_at = now(),
      status      = ${result.status},
      rows_read   = ${result.rowsRead ?? 0},
      added       = ${result.added ?? 0},
      updated     = ${result.updated ?? 0},
      retired     = ${result.retired ?? 0},
      skipped     = ${result.skipped ?? 0},
      detail      = ${JSON.stringify(result.detail ?? {})}::jsonb,
      error       = ${result.error ?? null}
    WHERE id = ${id}`;

  await db`
    UPDATE salesforce_feeds SET last_run_at = now(), last_status = ${result.status}
    WHERE kind = (SELECT kind FROM salesforce_runs WHERE id = ${id})`;
}

export async function getRuns(kind?: FeedKind, limit = 20): Promise<FeedRun[]> {
  const db = sql();
  const rows = (kind
    ? await db`SELECT * FROM salesforce_runs WHERE kind = ${kind}
               ORDER BY started_at DESC LIMIT ${limit}`
    : await db`SELECT * FROM salesforce_runs
               ORDER BY started_at DESC LIMIT ${limit}`) as Record<string, unknown>[];

  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind as FeedKind,
    report_name: (r.report_name as string | null) ?? null,
    started_at: String(r.started_at),
    finished_at: (r.finished_at as string | null) ?? null,
    status: r.status as FeedRun['status'],
    trigger: r.trigger as FeedRun['trigger'],
    rows_read: Number(r.rows_read ?? 0),
    added: Number(r.added ?? 0),
    updated: Number(r.updated ?? 0),
    retired: Number(r.retired ?? 0),
    skipped: Number(r.skipped ?? 0),
    detail: (r.detail as RunDetail) ?? {},
    error: (r.error as string | null) ?? null,
  }));
}
