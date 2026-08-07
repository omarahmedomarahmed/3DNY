import { NextResponse } from 'next/server';
import { getBuilding, updateBuilding } from '@/lib/queries';

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

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const building = await getBuilding(id);
    if (!building) {
      return NextResponse.json({ error: 'Building not found.' }, { status: 404 });
    }
    return NextResponse.json(building);
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const patch = (await req.json()) as Record<string, unknown>;
    await updateBuilding(id, patch);
    const building = await getBuilding(id);
    if (!building) {
      return NextResponse.json({ error: 'Building not found.' }, { status: 404 });
    }
    return NextResponse.json(building);
  } catch (err) {
    return fail(err);
  }
}
