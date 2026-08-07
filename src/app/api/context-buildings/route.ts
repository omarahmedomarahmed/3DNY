import { NextResponse } from 'next/server';
import { fetchCityContext } from '@/lib/city-context';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * The surrounding city for one viewport. Proxied rather than fetched from the
 * browser so the response can be cached at the edge and shared — the same few
 * grid cells are requested by everyone looking at Midtown.
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
  // A whole-borough request would return the truncation limit's worth of
  // arbitrary buildings, which looks like a bug rather than a city.
  if (e - w > 0.2 || n - s > 0.2) {
    return NextResponse.json({ error: 'bbox is too large.' }, { status: 400 });
  }

  try {
    const result = await fetchCityContext([w, s, e, n]);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
