import { SalesforceError, getAccessToken, salesforceConfig } from '@/lib/salesforce';
import { runReport, REPORT_ROW_LIMIT, type ReportData } from '@/lib/salesforce-reports';
import {
  missingRequired,
  staleColumns,
  toSpaceRows,
  toTenantRowsFromReport,
  type FeedKind,
} from '@/lib/salesforce-mapping';
import { getFeed, startRun, finishRun, FEED_LABELS, type Feed, type RunDetail } from '@/lib/salesforce-feeds';
import { commitImport, retireSpacesFromKind } from '@/lib/queries';
import { commitTenantImport } from '@/lib/tenant-import';
import { geocodeAll } from '@/lib/address-matcher';
import { normalizeAddress, sql } from '@/lib/db';
import type { MatchedRow } from '@/types';

/**
 * Running a bound report and making the map match it.
 *
 * The contract this implements is the one a leasing team actually wants: **the
 * report is the truth, and the map follows it.** Add a floor to the report and
 * it appears; take one off and it goes; change the rent and the card changes.
 * Nobody re-uploads anything.
 *
 * Two rules keep that from being dangerous.
 *
 * 1. **A truncated read never retires.** Salesforce caps a report response at
 *    2,000 detail rows. On row 2,001 the sync would otherwise conclude that
 *    everything it did not see has come off the market and quietly empty a
 *    third of the map. So a truncated read still writes what it saw, skips the
 *    retirement entirely, and records itself as `partial` with the reason.
 *
 * 2. **A sync only retires what a sync created.** Retirement is scoped to
 *    imports stamped `salesforce`, so landlord-feed rows and anything typed in
 *    by hand are untouchable from here.
 */

/** The stamp on every import this file creates. Retirement is scoped to it. */
export const SALESFORCE_SOURCE_KIND = 'salesforce';

export interface SyncResult {
  kind: FeedKind;
  reportName: string;
  rowsRead: number;
  added: number;
  updated: number;
  retired: number;
  skipped: number;
  status: 'ok' | 'partial';
  detail: RunDetail;
}

export class FeedNotReady extends Error {
  constructor(message: string, readonly remedy: string) {
    super(message);
    this.name = 'FeedNotReady';
  }
}

/**
 * A report that suddenly returns nothing is far more often a broken filter, a
 * changed folder permission or a renamed column than an entire portfolio going
 * off the market on a Tuesday. Writing that conclusion into the map
 * unattended is not a risk worth taking for the one time in a hundred it is
 * real, so an empty run refuses and says how to force it.
 */
function guardEmpty(report: ReportData, feed: Feed) {
  if (report.rows.length > 0) return;
  throw new FeedNotReady(
    `"${feed.report_name}" returned no rows.`,
    'Open the report in Salesforce and check its filters and date range. Nothing on the ' +
      'map has been changed. If the report really is empty on purpose, unbind the feed ' +
      'on the setup page instead — that is the deliberate way to clear a source.',
  );
}

function guardMapping(report: ReportData, feed: Feed, kind: FeedKind) {
  const missing = missingRequired(feed.column_map, kind);
  if (missing.length > 0) {
    throw new FeedNotReady(
      `The mapping for ${FEED_LABELS[kind]} is missing ${missing.map((f) => f.label).join(' and ')}.`,
      'Open the setup page and finish the mapping for this feed.',
    );
  }

  const stale = staleColumns(feed.column_map, report.columns);
  if (stale.length > 0) {
    throw new FeedNotReady(
      `"${feed.report_name}" no longer has ${stale.map((s) => `"${s.column}"`).join(', ')}.`,
      'A column was renamed or removed in Salesforce. Open the setup page and re-map this ' +
        'feed — nothing has been changed on the map.',
    );
  }
}

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

async function syncSpaces(feed: Feed, report: ReportData): Promise<SyncResult> {
  const { rows, skipped } = toSpaceRows(report.rows, feed.column_map);

  // Same matcher the CSV import and the landlord loader use. One address
  // resolver, so a fix to any of them reaches all three.
  const geocoded = await geocodeAll(rows.map((r) => r.addressRaw));
  const existing = new Map<string, string>();
  for (const b of (await sql()`
    SELECT id, address_normalized FROM buildings`) as {
      id: string; address_normalized: string;
    }[]) {
    existing.set(b.address_normalized, b.id);
  }

  const matched: MatchedRow[] = rows.map((row) => {
    const hit = geocoded.get(row.addressRaw);
    const normalized = normalizeAddress(hit?.resolvedAddress ?? row.addressRaw);
    return {
      ...row,
      match: {
        confidence: hit?.confidence ?? 'unmatched',
        bin: hit?.bin ?? null,
        bbl: hit?.bbl ?? null,
        lon: hit?.lon ?? null,
        lat: hit?.lat ?? null,
        resolvedAddress: hit?.resolvedAddress ?? null,
        buildingId: existing.get(normalized) ?? null,
        explanation: hit?.explanation ?? 'No match from NYC records.',
      },
    };
  });

  const unresolved = matched
    .filter((r) => r.match.confidence === 'unmatched' && !r.match.buildingId)
    .map((r) => ({ address: r.addressDisplay, reason: r.match.explanation }));

  const commit = await commitImport(
    `${feed.report_name} — ${new Date().toISOString().slice(0, 10)}`,
    null,
    matched,
    { sourceKind: SALESFORCE_SOURCE_KIND },
  );

  // The retirement, and the one condition under which it is skipped.
  let retired = 0;
  let retiredRows: { address: string; floor: string }[] = [];
  const detail: RunDetail = {
    unresolved: unresolved.slice(0, 50),
    skippedRows: skipped.slice(0, 50),
  };

  if (report.complete) {
    const result = await retireSpacesFromKind(SALESFORCE_SOURCE_KIND, [commit.importId]);
    retired = result.retired;
    retiredRows = result.rows;
    detail.retiredSpaces = retiredRows.slice(0, 100);
  } else {
    detail.truncated = true;
    detail.note =
      `Salesforce returned the first ${REPORT_ROW_LIMIT.toLocaleString()} rows and stopped. ` +
      'What it sent has been imported, but nothing was taken off the market — the rows it ' +
      'did not send are not gone. Add a filter to the report so it fits inside the limit.';
  }

  return {
    kind: 'spaces',
    reportName: feed.report_name,
    rowsRead: report.rows.length,
    added: commit.inserted,
    updated: commit.updated,
    retired,
    skipped: skipped.length + commit.skipped,
    status: report.complete ? 'ok' : 'partial',
    detail,
  };
}

// ---------------------------------------------------------------------------
// Occupiers and clients
// ---------------------------------------------------------------------------

async function syncTenants(
  feed: Feed,
  report: ReportData,
  kind: 'occupiers' | 'clients',
  instanceUrl: string,
): Promise<SyncResult> {
  const { rows, skipped } = toTenantRowsFromReport(
    report.rows, feed.column_map, kind, instanceUrl);

  const commit = await commitTenantImport(
    `${feed.report_name} — ${new Date().toISOString().slice(0, 10)}`,
    rows,
    { source: 'salesforce' },
  );

  const detail: RunDetail = {
    unresolved: commit.unresolved.slice(0, 50),
    skippedRows: skipped.slice(0, 50),
  };
  if (!report.complete) {
    detail.truncated = true;
    detail.note =
      `Salesforce returned the first ${REPORT_ROW_LIMIT.toLocaleString()} rows and stopped. ` +
      'Everything it sent is on the map; anything past that row is not.';
  }

  return {
    kind,
    reportName: feed.report_name,
    rowsRead: report.rows.length,
    added: commit.inserted,
    updated: commit.updated,
    // Tenancies are never retired by a sync. A company that dropped off this
    // month's report has not necessarily left the building — the report's
    // filters changed far more often than the tenant did — and a tenancy
    // vanishing from the map is a silent loss of context nobody asked for.
    retired: 0,
    skipped: skipped.length + commit.skipped,
    status: report.complete ? 'ok' : 'partial',
    detail,
  };
}

// ---------------------------------------------------------------------------

/**
 * Run one feed. Records the run either way, so a failure is visible on the
 * setup page rather than only in a server log nobody reads.
 */
export async function syncFeed(
  kind: FeedKind,
  opts: { trigger?: 'manual' | 'daily' } = {},
): Promise<SyncResult> {
  const config = salesforceConfig();
  if (!config) {
    throw new FeedNotReady(
      'Salesforce is not connected.',
      'Set SALESFORCE_INSTANCE_URL, SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET in ' +
        'Vercel, then redeploy.',
    );
  }

  const feed = await getFeed(kind);
  if (!feed) {
    throw new FeedNotReady(
      `No report is bound to ${FEED_LABELS[kind]}.`,
      'Choose one on the setup page.',
    );
  }
  if (!feed.enabled) {
    throw new FeedNotReady(
      `The ${FEED_LABELS[kind]} feed is paused.`,
      'Turn it back on from the setup page.',
    );
  }

  const runId = await startRun({
    kind,
    reportId: feed.report_id,
    reportName: feed.report_name,
    trigger: opts.trigger ?? 'manual',
  });

  try {
    const token = await getAccessToken(config);
    const report = await runReport(config, token, feed.report_id);

    guardMapping(report, feed, kind);
    guardEmpty(report, feed);

    const result =
      kind === 'spaces'
        ? await syncSpaces(feed, report)
        : await syncTenants(feed, report, kind, config.instanceUrl);

    await finishRun(runId, {
      status: result.status,
      rowsRead: result.rowsRead,
      added: result.added,
      updated: result.updated,
      retired: result.retired,
      skipped: result.skipped,
      detail: result.detail,
    });

    return result;
  } catch (err) {
    const message =
      err instanceof SalesforceError || err instanceof FeedNotReady
        ? `${err.message} ${err.remedy}`
        : err instanceof Error
          ? err.message
          : 'Unexpected error.';
    await finishRun(runId, { status: 'failed', error: message });
    throw err;
  }
}

/**
 * Every enabled feed, one after another.
 *
 * Sequential rather than parallel on purpose: all three hit the same
 * geocoder and the same database, and three at once would triple the pressure
 * on both to save a few seconds on a job that runs unattended at 4am.
 *
 * One feed failing does not stop the others. A broken clients report should
 * not mean the availability map goes stale.
 */
export async function syncAllFeeds(
  trigger: 'manual' | 'daily' = 'daily',
): Promise<{ results: SyncResult[]; failures: { kind: FeedKind; error: string }[] }> {
  const results: SyncResult[] = [];
  const failures: { kind: FeedKind; error: string }[] = [];

  for (const kind of ['spaces', 'occupiers', 'clients'] as FeedKind[]) {
    const feed = await getFeed(kind);
    if (!feed || !feed.enabled) continue;
    try {
      results.push(await syncFeed(kind, { trigger }));
    } catch (err) {
      failures.push({
        kind,
        error: err instanceof Error ? err.message : 'Unexpected error.',
      });
    }
  }

  return { results, failures };
}
