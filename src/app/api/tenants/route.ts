import { NextResponse } from 'next/server';
import { createTenant, getTenants } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  if (message.includes('DATABASE_URL')) {
    return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const buildingId = new URL(req.url).searchParams.get('buildingId');
    // Same shape the map gets, including the roster it came from — a tenant
    // read through this route and one read through the buildings route have to
    // be the same object, or the source marker works on one screen and not the
    // other.
    return NextResponse.json(await getTenants(buildingId));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Parameters<typeof createTenant>[0];
    if (!body?.building_id || !body?.company_name) {
      return NextResponse.json(
        { error: 'building_id and company_name are required.' },
        { status: 400 },
      );
    }
    return NextResponse.json(await createTenant(body), { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
