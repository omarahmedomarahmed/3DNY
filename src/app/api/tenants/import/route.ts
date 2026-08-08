import { NextResponse } from 'next/server';
import { parseTenantCsv, type TenantSheetKind } from '@/lib/tenant-csv';
import { commitTenantImport } from '@/lib/tenant-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Imports a tenant roster or a client sheet.
 *
 * One endpoint for both, because they are the same operation on the same
 * table; `kind` decides what a row without an explicit relationship column
 * means. Parse and commit are one request rather than the two the availability
 * import uses: that one has a review queue because an unmatched availability is
 * ours and worth stopping for, and this one does not, because an unresolved
 * address in a market roster is a building we do not care about.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      filename?: string;
      csv?: string;
      kind?: TenantSheetKind;
    };

    if (!body?.csv || typeof body.csv !== 'string') {
      return NextResponse.json({ error: 'No CSV content supplied.' }, { status: 400 });
    }

    const kind: TenantSheetKind = body.kind === 'clients' ? 'clients' : 'roster';
    const parsed = parseTenantCsv(body.csv, kind);

    if (parsed.rows.length === 0) {
      return NextResponse.json(
        { error: parsed.errors[0] ?? 'No tenant rows found.', errors: parsed.errors },
        { status: 400 },
      );
    }

    const result = await commitTenantImport(body.filename ?? 'tenants.csv', parsed.rows, {
      // A file carrying Salesforce record ids IS the CRM's data, however it
      // reached us, and the map should say so rather than calling it a sheet.
      source: parsed.fromSalesforce ? 'salesforce' : 'csv',
    });

    return NextResponse.json({
      ...result,
      rowsRead: parsed.rows.length,
      fromSalesforce: parsed.fromSalesforce,
      // Parse warnings survive to the response. A lease expiration that could
      // not be read is a fact about the sheet the person who uploaded it needs.
      warnings: parsed.errors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error.';
    if (message.includes('DATABASE_URL')) {
      return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
