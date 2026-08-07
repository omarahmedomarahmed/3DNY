import { NextResponse } from 'next/server';
import { deleteRow, updateSpace } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  if (message.includes('DATABASE_URL')) {
    return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const patch = (await req.json()) as Record<string, unknown>;
    const updated = await updateSpace(id, patch);
    if (!updated) {
      return NextResponse.json(
        { error: 'Space not found, or no editable fields were supplied.' },
        { status: 404 },
      );
    }
    return NextResponse.json(updated);
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    await deleteRow('spaces', id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
