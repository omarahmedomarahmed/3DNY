import { NextResponse } from 'next/server';
import { getBuildingsWithSpaces } from '@/lib/queries';
import { createBuildingFromAddress } from '@/lib/manual-entry';

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

/**
 * Creates one building from an address, with nothing in it.
 *
 * A building with no available space is a legitimate record and the reason
 * this endpoint exists: you know the tower before you know what is available
 * in it, and having it lets tenants, landlord notes and the next availability
 * attach to something real instead of waiting for a sheet.
 *
 * An address that already resolves to a building returns that building rather
 * than making a second one, with `created: false` so the caller can say so.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { address?: string };
    if (!body?.address || !body.address.trim()) {
      return NextResponse.json({ error: 'An address is required.' }, { status: 400 });
    }
    const result = await createBuildingFromAddress(body as { address: string });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (err) {
    return fail(err);
  }
}
