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
 * Below this, a viewport covers more of the city than the request cap allows,
 * and extruded massing that small reads as noise anyway. Above it, the
 * surrounding city appears and the map stops looking like a diagram.
 */
export const CITY_CONTEXT_ZOOM = 13.5;

/** Wait for the pan to settle before spending a request on the new viewport. */
const SETTLE_MS = 400;

/** Extra margin around the reported viewport, as a fraction of its size. */
const PAD = 0.35;

/** Must match the API's own guard, or a padded request comes back 400. */
const MAX_SPAN = 0.2;

/**
 * Loads the surrounding city for whatever is on screen.
 *
 * Responses are keyed by a snapped bbox and kept for the life of the page, so
 * panning back to a block you have already seen is instant and free. Failures
 * are swallowed: scenery that does not arrive should never interrupt a meeting,
 * and the map is fully usable without it.
 */
export function useCityContext(map: maplibregl.Map | null, zoom: number) {
  const [buildings, setBuildings] = useState<ContextBuilding[]>([]);
  const cache = useRef(new Map<string, ContextBuilding[]>());
  const inflight = useRef<Set<string>>(new Set());
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!map) return;
    if (zoom < CITY_CONTEXT_ZOOM) {
      setBuildings([]);
      lastKey.current = null;
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      const b = map.getBounds();
      const w = b.getWest();
      const s = b.getSouth();
      const e = b.getEast();
      const n = b.getNorth();

      // The map is pitched and rotated, so the visible ground extends past the
      // axis-aligned bounds MapLibre reports — without padding, the city stops
      // in a hard diagonal line across the corners of the frame. The pad is
      // clamped so the request stays inside the size the API accepts.
      const padX = Math.min((e - w) * PAD, (MAX_SPAN - (e - w)) / 2);
      const padY = Math.min((n - s) * PAD, (MAX_SPAN - (n - s)) / 2);
      const raw: [number, number, number, number] = [
        w - Math.max(padX, 0),
        s - Math.max(padY, 0),
        e + Math.max(padX, 0),
        n + Math.max(padY, 0),
      ];
      const snapped = snapBbox(raw);
      const key = bboxKey(snapped);

      const cached = cache.current.get(key);
      if (cached) {
        if (!cancelled && lastKey.current !== key) {
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
        if (!cancelled) {
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
      cancelled = true;
      if (timer) clearTimeout(timer);
      map.off('moveend', schedule);
    };
  }, [map, zoom]);

  return buildings;
}
