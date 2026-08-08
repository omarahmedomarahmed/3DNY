import { NextResponse } from 'next/server';
import { deleteRow, findTable, updateRow } from '@/lib/admin-tables';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ table: string; id: string }> };

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  if (message.includes('DATABASE_URL')) {
    return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function PATCH(req: Request, { params }: Params) {
  const { table, id } = await params;
  const spec = findTable(table);
  if (!spec) return NextResponse.json({ error: 'Unknown table.' }, { status: 404 });

  try {
    const patch = (await req.json()) as Record<string, unknown>;
    const row = await updateRow(spec, decodeURIComponent(id), patch);
    if (!row) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }
    return NextResponse.json(row);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { table, id } = await params;
  const spec = findTable(table);
  if (!spec) return NextResponse.json({ error: 'Unknown table.' }, { status: 404 });

  try {
    const ok = await deleteRow(spec, decodeURIComponent(id));
    if (!ok) return NextResponse.json({ error: 'Row not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
