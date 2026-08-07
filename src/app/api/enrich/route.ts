import { NextResponse } from 'next/server';
import { enrichMissingGeometry } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Backfills real NYC footprint geometry for any building that lacks it.
 * Import already does this automatically; this route exists so a failed or
 * partial lookup can be retried from the Setup page without re-importing.
 */
export async function POST() {
  try {
    const result = await enrichMissingGeometry();
    return NextResponse.json(result);
  } catch (err) {
    const message = (err as Error).message;
    const needsSetup = message.includes('DATABASE_URL');
    return NextResponse.json(
      { error: message, needsSetup },
      { status: needsSetup ? 503 : 500 },
    );
  }
}
