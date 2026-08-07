import { NextResponse } from 'next/server';
import { ensureLandlordsForAllBuildings } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Gives every building a landlord to edit instead of asking the team to create
 * them from scratch. Seeded from the city's owner of record and flagged for
 * review, because the name on a deed is rarely the name a broker would use.
 */
export async function POST() {
  try {
    const result = await ensureLandlordsForAllBuildings();
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
