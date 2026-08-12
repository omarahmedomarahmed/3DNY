import { NextResponse } from 'next/server';
import { SalesforceError, getAccessToken, salesforceConfig } from '@/lib/salesforce';
import { runReport } from '@/lib/salesforce-reports';
import {
  suggestMapping,
  toSpaceRows,
  toTenantRowsFromReport,
  missingRequired,
  type FeedKind,
} from '@/lib/salesforce-mapping';
import { getFeed } from '@/lib/salesforce-feeds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const KINDS = new Set(['spaces', 'occupiers', 'clients']);

/**
 * One report: its columns, a suggested mapping, and a preview of what its rows
 * would become.
 *
 * The preview is the part that matters. A mapping table on its own is a guess;
 * a mapping table beside ten of the org's own rows, already converted, is
 * something a person can actually check — "that column is the building name,
 * not the address" is obvious the moment you see `One Grand Central Place` in
 * the address field, and invisible until then.
 *
 * `?kind=` decides which field set to suggest against. `?mapping=` (JSON)
 * previews a mapping the user has edited rather than the suggested one, so the
 * table updates as they change it.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const kindParam = url.searchParams.get('kind') ?? 'spaces';
  if (!KINDS.has(kindParam)) {
    return NextResponse.json({ error: `Unknown feed "${kindParam}".` }, { status: 400 });
  }
  const kind = kindParam as FeedKind;

  const config = salesforceConfig();
  if (!config) {
    return NextResponse.json({ error: 'Salesforce is not connected.' }, { status: 400 });
  }

  try {
    const token = await getAccessToken(config);
    const report = await runReport(config, token, id);

    // Precedence: what the user is editing right now, then what they saved
    // earlier for this feed, then a fresh suggestion. Re-suggesting over a
    // saved mapping would silently undo a correction somebody made by hand.
    let mapping: Record<string, string>;
    const edited = url.searchParams.get('mapping');
    if (edited) {
      try {
        mapping = JSON.parse(edited) as Record<string, string>;
      } catch {
        return NextResponse.json({ error: 'The mapping parameter is not valid JSON.' }, { status: 400 });
      }
    } else {
      const saved = await getFeed(kind).catch(() => null);
      mapping =
        saved && saved.report_id === id && Object.keys(saved.column_map).length > 0
          ? saved.column_map
          : suggestMapping(report.columns, kind);
    }

    const sample = report.rows.slice(0, 10);
    const preview =
      kind === 'spaces'
        ? toSpaceRows(sample, mapping)
        : toTenantRowsFromReport(sample, mapping, kind, config.instanceUrl);

    return NextResponse.json({
      id: report.id,
      name: report.name,
      format: report.format,
      columns: report.columns,
      rowCount: report.rows.length,
      complete: report.complete,
      mapping,
      missingRequired: missingRequired(mapping, kind).map((f) => ({
        key: f.key,
        label: f.label,
      })),
      // Raw rows too: when a mapping looks wrong, the fastest way to see why is
      // the untouched cell beside the converted one.
      sampleRows: sample,
      preview: preview.rows.slice(0, 10),
      previewSkipped: preview.skipped,
    });
  } catch (err) {
    if (err instanceof SalesforceError) {
      return NextResponse.json(
        { error: err.message, remedy: err.remedy },
        { status: err.status && err.status < 500 ? 400 : 502 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected error.' },
      { status: 500 },
    );
  }
}
