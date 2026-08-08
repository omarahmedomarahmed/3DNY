import { NextResponse } from 'next/server';
import { fetchStreetscape } from '@/lib/streetscape';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Streets and water for one viewport — the ground plane the city stands on.
 * Proxied like /api/context-buildings, and for the same reason: the responses
 * are cached at the edge by snapped bbox, so the same Midtown cells are
 * fetched from NYC once and shared by everyone.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('bbox');
  if (!raw) {
    return NextResponse.json({ error: 'bbox is required.' }, { status: 400 });
  }

  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json(
      { error: 'bbox must be four numbers: west,south,east,north.' },
      { status: 400 },
    );
  }

  const [w, s, e, n] = parts as [number, number, number, number];
  if (w >= e || s >= n) {
    return NextResponse.json({ error: 'bbox is inside out.' }, { status: 400 });
  }
  if (e - w > 0.2 || n - s > 0.2) {
    return NextResponse.json({ error: 'bbox is too large.' }, { status: 400 });
  }

  try {
    const result = await fetchStreetscape([w, s, e, n]);
    return NextResponse.json(result, {
      // Planimetric geometry is effectively static; a week is conservative.
      headers: { 'Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=2592000' },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
