import { NextResponse } from 'next/server';
import { fetchTransit } from '@/lib/transit';

export const runtime = 'nodejs';
export const maxDuration = 45;

/**
 * Transit stops for one viewport. Proxied rather than fetched from the browser
 * so the response can be cached at the edge and shared: Overpass is a free,
 * volunteer-run service and hammering it from every open tab would be rude as
 * well as slow.
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
    const result = await fetchTransit([w, s, e, n]);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
