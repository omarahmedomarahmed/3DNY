'use client';

import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import {
  bboxKey,
  snapBbox,
  type ContextBuilding,
  type ContextResult,
} from '@/lib/city-context';

/**
 * Below this the viewport covers more ground than one request can carry.
 *
 * It sits deliberately below the zoom the map opens at once it has framed the
 * imported buildings — roughly 13 — because the opening frame is the first
 * thing anyone sees, and an empty plane there is exactly the impression the
 * city context exists to prevent.
 */
export const CITY_CONTEXT_ZOOM = 12.4;

/** Wait for the pan to settle before spending a request on the new viewport. */
const SETTLE_MS = 400;

/** Extra margin around the reported viewport, as a fraction of its size. */
const PAD = 0.35;

/** Must match the API's own guard, or a padded request comes back 400. */
/** What `/api/context-buildings` will serve. Anything wider comes back 400. */
const MAX_SPAN = 0.2;
/**
 * What we may ask for before `snapBbox` rounds outward.
 *
 * Snapping expands each edge to a hundredth of a degree, so a bbox trimmed to
 * exactly `MAX_SPAN` can leave here at 0.21 and be refused — see the same
 * constant, and the same bug, in `useStreetscape`.
 */
const REQUEST_SPAN = MAX_SPAN - 0.02;
/** Half-width, in degrees, of the box loaded around a free camera. */
const FOCUS_HALF = 0.045;

/**
 * Loads the surrounding city for whatever is on screen.
 *
 * Responses are keyed by a snapped bbox and kept for the life of the page, so
 * panning back to a block you have already seen is instant and free. Failures
 * are swallowed: scenery that does not arrive should never interrupt a meeting,
 * and the map is fully usable without it.
 */
/** Trims a bbox to `REQUEST_SPAN` on each axis, keeping its centre. */
function clampSpan(
  [w, s, e, n]: [number, number, number, number],
): [number, number, number, number] {
  const trim = (lo: number, hi: number): [number, number] => {
    if (hi - lo <= REQUEST_SPAN) return [lo, hi];
    const mid = (lo + hi) / 2;
    return [mid - REQUEST_SPAN / 2, mid + REQUEST_SPAN / 2];
  };
  const [west, east] = trim(w, e);
  const [south, north] = trim(s, n);
  return [west, south, east, north];
}

export function useCityContext(
  map: maplibregl.Map | null,
  zoom: number,
  enabled = true,
  /**
   * Load around this point instead of around the map's viewport — see the
   * same parameter on `useStreetscape`. Free look passes its own position.
   */
  focus: [number, number] | null = null,
) {
  const [buildings, setBuildings] = useState<ContextBuilding[]>([]);
  const cache = useRef(new Map<string, ContextBuilding[]>());
  const inflight = useRef<Set<string>>(new Set());
  const lastKey = useRef<string | null>(null);
  /** The bbox the map is currently asking for — see `load`. */
  const wanted = useRef<string | null>(null);

  useEffect(() => {
    if (!map) return;
    // Nothing to fetch when the clean map is showing: the city would be
    // downloaded, held in memory and never drawn.
    if (!enabled) {
      setBuildings([]);
      lastKey.current = null;
      wanted.current = null;
      return;
    }
    if (zoom < CITY_CONTEXT_ZOOM) {
      setBuildings([]);
      lastKey.current = null;
      wanted.current = null;
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      const b = map.getBounds();
      // A box centred on the free camera, when there is one, rather than on a
      // viewport it is no longer flying through.
      const w = focus ? focus[0] - FOCUS_HALF : b.getWest();
      const s = focus ? focus[1] - FOCUS_HALF : b.getSouth();
      const e = focus ? focus[0] + FOCUS_HALF : b.getEast();
      const n = focus ? focus[1] + FOCUS_HALF : b.getNorth();

      // The map is pitched and rotated, so the visible ground extends past the
      // axis-aligned bounds MapLibre reports — without padding, the city stops
      // in a hard diagonal line across the corners of the frame. The pad is
      // clamped so the request stays inside the size the API accepts.
      const padX = Math.min((e - w) * PAD, (MAX_SPAN - (e - w)) / 2);
      const padY = Math.min((n - s) * PAD, (MAX_SPAN - (n - s)) / 2);
      // Trimmed as well as padded: the padding declined to widen a viewport
      // already past the limit, but sent it anyway, and the surrounding city
      // silently never arrived on any window wide enough to trip it.
      const raw = clampSpan([
        w - Math.max(padX, 0),
        s - Math.max(padY, 0),
        e + Math.max(padX, 0),
        n + Math.max(padY, 0),
      ]);
      const snapped = snapBbox(raw);
      const key = bboxKey(snapped);

      // What the map wants now, judged at reply time rather than by whoever
      // asked — the opening fly-to re-runs this effect continuously, and a
      // reply belonging to a superseded run used to be cached and discarded
      // with nothing left to re-request it.
      wanted.current = key;

      const cached = cache.current.get(key);
      if (cached) {
        if (lastKey.current !== key) {
          lastKey.current = key;
          setBuildings(cached);
        }
        return;
      }
      if (inflight.current.has(key)) return;
      inflight.current.add(key);

      try {
        const res = await fetch(`/api/context-buildings?bbox=${snapped.join(',')}`);
        if (!res.ok) return;
        const data = (await res.json()) as ContextResult;
        cache.current.set(key, data.buildings);
        if (wanted.current === key) {
          lastKey.current = key;
          setBuildings(data.buildings);
        }
      } catch {
        // Scenery is optional. Leave whatever is already drawn in place.
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
  }, [map, zoom, enabled, focus ? focus.join(',') : '']);

  return buildings;
}
