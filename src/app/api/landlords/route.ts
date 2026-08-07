import { NextResponse } from 'next/server';
import { getLandlords, upsertLandlord } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  if (message.includes('DATABASE_URL')) {
    return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json(await getLandlords());
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Parameters<typeof upsertLandlord>[0];
    if (!body?.name) {
      return NextResponse.json({ error: 'name is required.' }, { status: 400 });
    }
    return NextResponse.json(await upsertLandlord(body));
  } catch (err) {
    return fail(err);
  }
}
