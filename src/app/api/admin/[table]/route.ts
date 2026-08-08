import { NextResponse } from 'next/server';
import { deleteAll, findTable, listRows, wipePhrase, countRows } from '@/lib/admin-tables';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ table: string }> };

function fail(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  if (message.includes('DATABASE_URL')) {
    return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
  }
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: Request, { params }: Params) {
  const { table } = await params;
  const spec = findTable(table);
  if (!spec) return NextResponse.json({ error: 'Unknown table.' }, { status: 404 });

  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
  const search = url.searchParams.get('q')?.trim() || undefined;

  try {
    const { rows, total } = await listRows(spec, { limit, offset, search });
    return NextResponse.json({
      key: spec.key,
      label: spec.label,
      description: spec.description,
      cascades: spec.cascades ?? null,
      columns: spec.columns,
      primaryKey: spec.table === 'address_aliases' ? 'raw_address' : 'id',
      rows,
      total,
      limit,
      offset,
      // Handed to the client so the phrase shown and the phrase checked can
      // never drift apart.
      wipePhrase: wipePhrase(spec, await countRows(spec)),
    });
  } catch (err) {
    return fail(err);
  }
}

/** Empties a table. Requires the exact confirmation phrase from GET. */
export async function DELETE(req: Request, { params }: Params) {
  const { table } = await params;
  const spec = findTable(table);
  if (!spec) return NextResponse.json({ error: 'Unknown table.' }, { status: 404 });

  try {
    const body = (await req.json().catch(() => ({}))) as { confirm?: string };
    const result = await deleteAll(spec, body.confirm ?? '');
    return NextResponse.json(result);
  } catch (err) {
    return fail(err, 400);
  }
}
