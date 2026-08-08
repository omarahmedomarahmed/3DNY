import { NextResponse } from 'next/server';
import {
  SalesforceError,
  getAccessToken,
  runQuery,
  salesforceConfig,
  toTenantRows,
} from '@/lib/salesforce';
import { commitTenantImport } from '@/lib/tenant-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET  — is Salesforce configured, and what would a sync do?
 * POST — do it.
 *
 * `?dryRun=1` on the POST runs the query and the mapping and reports what it
 * would write without writing it. That is the first thing to run against a new
 * org: field names differ everywhere, and finding out that every row mapped to
 * "no address" is much better before three thousand tenancies land on the map
 * than after.
 */

function describe(err: unknown) {
  if (err instanceof SalesforceError) {
    return NextResponse.json(
      { error: err.message, remedy: err.remedy, configured: true },
      { status: err.status && err.status < 500 ? 400 : 502 },
    );
  }
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  if (message.includes('DATABASE_URL')) {
    return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

const NOT_CONFIGURED = {
  configured: false,
  error: 'Salesforce is not configured.',
  remedy:
    'Set SALESFORCE_INSTANCE_URL, SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET. ' +
    'Until then, export the same report from Salesforce and use the tenant CSV import — ' +
    'it produces exactly the same result.',
};

export async function GET() {
  const config = salesforceConfig();
  if (!config) return NextResponse.json(NOT_CONFIGURED, { status: 200 });
  return NextResponse.json({
    configured: true,
    instanceUrl: config.instanceUrl,
    soql: config.soql,
    // Never the secret. This endpoint exists to be read from a setup screen.
    fieldMap: config.fieldMap,
  });
}

export async function POST(req: Request) {
  const config = salesforceConfig();
  if (!config) return NextResponse.json(NOT_CONFIGURED, { status: 400 });

  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1';

  try {
    const token = await getAccessToken(config);
    const records = await runQuery(config, token);
    const { rows, skipped } = toTenantRows(records, config);

    if (dryRun) {
      return NextResponse.json({
        configured: true,
        dryRun: true,
        recordsRead: records.length,
        wouldWrite: rows.length,
        skipped,
        sample: rows.slice(0, 10),
      });
    }

    if (rows.length === 0) {
      return NextResponse.json(
        {
          configured: true,
          error: `Salesforce returned ${records.length} records and none of them had both a company and an address.`,
          remedy:
            'Set SALESFORCE_SOQL to a query that selects the address, and SALESFORCE_FIELD_MAP ' +
            'to point Address/Floors/Relationship at your org’s field names. ' +
            'Run again with ?dryRun=1 to check before writing.',
          skipped: skipped.slice(0, 20),
        },
        { status: 400 },
      );
    }

    // Same commit path as the CSV import, on purpose: one address matcher, one
    // floor parser, one upsert. Two paths into the same table would drift, and
    // the one used less often would be the one that broke.
    const result = await commitTenantImport(
      `Salesforce sync ${new Date().toISOString().slice(0, 10)}`,
      rows,
      { source: 'salesforce' },
    );

    return NextResponse.json({
      configured: true,
      recordsRead: records.length,
      ...result,
      skipped: skipped.slice(0, 20),
      skippedCount: skipped.length,
    });
  } catch (err) {
    return describe(err);
  }
}
