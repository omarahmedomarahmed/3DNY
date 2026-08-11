'use client';

import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { bboxKey, snapBbox } from '@/lib/city-context';
import type { StreetscapeResult } from '@/lib/streetscape';

/**
 * Where our own ground plane switches on. Matches the city-context massing so
 * the whole self-drawn city — ground, streets, water, buildings — arrives as
 * one thing rather than in visible instalments.
 */
export const STREETSCAPE_ZOOM = 12.4;

const SETTLE_MS = 400;
const PAD = 0.35;
/** What `/api/streetscape` will serve. Anything wider comes back 400. */
const MAX_SPAN = 0.2;
/**
 * What we are allowed to ask for before snapping.
 *
 * `snapBbox` rounds outward to a hundredth of a degree on each edge, so a bbox
 * trimmed to exactly `MAX_SPAN` can leave here at 0.21 and be refused. Two grid
 * cells of headroom is the difference between a map with streets on it and one
 * without.
 */
const REQUEST_SPAN = MAX_SPAN - 0.02;

const EMPTY: StreetscapeResult = {
  roads: [],
  water: [],
  parks: [],
  trees: [],
  entrances: [],
  truncated: false,
  bbox: [0, 0, 0, 0],
};

/** Trims a bbox to `REQUEST_SPAN` on each axis, keeping its centre. */
function clampSpan(
  [w, s, e, n]: [number, number, number, number],
): [number, number, number, number] {
  const trim = (lo: number, hi: number): [number, number] => {
    const span = hi - lo;
    if (span <= REQUEST_SPAN) return [lo, hi];
    const mid = (lo + hi) / 2;
    return [mid - REQUEST_SPAN / 2, mid + REQUEST_SPAN / 2];
  };
  const [west, east] = trim(w, e);
  const [south, north] = trim(s, n);
  return [west, south, east, north];
}

/**
 * Loads streets and water for the viewport, exactly as useCityContext loads
 * the massing: snapped-bbox cache for the life of the page, silent failures —
 * a missing ground plane degrades to the basemap, never to an interruption.
 */
export function useStreetscape(map: maplibregl.Map | null, zoom: number, enabled = true) {
  const [data, setData] = useState<StreetscapeResult>(EMPTY);
  const cache = useRef(new Map<string, StreetscapeResult>());
  const inflight = useRef<Set<string>>(new Set());
  const lastKey = useRef<string | null>(null);
  /** The bbox the map is currently asking for — see `load`. */
  const wanted = useRef<string | null>(null);

  useEffect(() => {
    if (!map) return;
    if (!enabled || zoom < STREETSCAPE_ZOOM) {
      setData(EMPTY);
      lastKey.current = null;
      wanted.current = null;
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      const b = map.getBounds();
      const w = b.getWest();
      const s = b.getSouth();
      const e = b.getEast();
      const n = b.getNorth();

      const padX = Math.min((e - w) * PAD, (MAX_SPAN - (e - w)) / 2);
      const padY = Math.min((n - s) * PAD, (MAX_SPAN - (n - s)) / 2);
      /**
       * Clamped to what the endpoint will actually serve.
       *
       * The padding maths already declined to pad a viewport wider than
       * `MAX_SPAN`, but it had no answer for one that was *already* wider —
       * it sent the oversized bbox anyway and the endpoint answered 400. On a
       * 1600-pixel window over Manhattan that is the state the map opens in,
       * so the streets and the water arrived only if the user happened to zoom
       * in afterwards. Trimming to the centre asks for less than the whole
       * viewport, which is strictly better than asking for something that will
       * be refused.
       */
      const raw = clampSpan([
        w - Math.max(padX, 0),
        s - Math.max(padY, 0),
        e + Math.max(padX, 0),
        n + Math.max(padY, 0),
      ]);
      const snapped = snapBbox(raw);
      const key = bboxKey(snapped);

      /**
       * What the map wants *now*, recorded before anything can await.
       *
       * This used to be a `cancelled` flag closed over by the effect, and it
       * silently lost the streetscape on almost every page load. The effect
       * re-runs whenever the zoom changes, which it does continuously through
       * the opening fly-to; each re-run cancelled the request in flight; and
       * the reply that finally arrived belonged to a cancelled run, so it was
       * cached and thrown away. Nothing re-requested it, because the next run
       * had already seen the key in `inflight` and returned. The result was a
       * map with no streets and no water at all unless you happened to pan
       * afterwards — which is exactly what was reported.
       *
       * A ref outlives the effect, so a reply is judged against the current
       * intention rather than against the intention of whoever asked.
       */
      wanted.current = key;

      const cached = cache.current.get(key);
      if (cached) {
        if (lastKey.current !== key) {
          lastKey.current = key;
          setData(cached);
        }
        return;
      }
      if (inflight.current.has(key)) return;
      inflight.current.add(key);

      try {
        const res = await fetch(`/api/streetscape?bbox=${snapped.join(',')}`);
        if (!res.ok) return;
        const result = (await res.json()) as StreetscapeResult;
        cache.current.set(key, result);
        if (wanted.current === key) {
          lastKey.current = key;
          setData(result);
        }
      } catch {
        // The basemap is still underneath; missing ground is not an error state.
      } finally {
        inflight.current.delete(key);
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), SETTLE_MS);
    };

    void load();
    map.on('moveend', schedule);

    return () => {
      if (timer) clearTimeout(timer);
      map.off('moveend', schedule);
    };
  }, [map, zoom, enabled]);

  return data;
}
