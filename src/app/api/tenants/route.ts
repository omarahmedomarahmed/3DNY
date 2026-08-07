import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { createTenant } from '@/lib/queries';
import type { Tenant } from '@/types';

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
    const db = sql();
    const rows = buildingId
      ? await db(`SELECT * FROM tenants WHERE building_id = $1 ORDER BY company_name`, [buildingId])
      : await db(`SELECT * FROM tenants ORDER BY company_name`);
    return NextResponse.json(rows as unknown as Tenant[]);
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
