import { NextResponse } from 'next/server';
import { getBuildingsWithSpaces } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : 'Unexpected server error.';
  // sql() throws a plain-English setup message when DATABASE_URL is missing.
  if (message.includes('DATABASE_URL')) {
    return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json(await getBuildingsWithSpaces());
  } catch (err) {
    return fail(err);
  }
}
