import { NextResponse } from 'next/server';
import { resolveAddress } from '@/lib/manual-entry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * What an address is, before anything is created.
 *
 * The add-a-building form calls this as you finish typing, so the answer shows
 * up before you commit: either "you already have this one" or "this resolves
 * to a real BIN and would be new". Creating a second row for a tower somebody
 * else already added, because the two of you wrote the address differently, is
 * the failure this exists to prevent — and the fix is showing the match rather
 * than silently trusting it.
 */
export async function POST(req: Request) {
  try {
    const { address } = (await req.json()) as { address?: string };
    if (!address || !address.trim()) {
      return NextResponse.json({ error: 'An address is required.' }, { status: 400 });
    }
    return NextResponse.json(await resolveAddress(address.trim()));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error.';
    if (message.includes('DATABASE_URL')) {
      return NextResponse.json({ error: message, needsSetup: true }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
