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
const MAX_SPAN = 0.2;

const EMPTY: StreetscapeResult = {
  roads: [],
  water: [],
  parks: [],
  trees: [],
  entrances: [],
  truncated: false,
  bbox: [0, 0, 0, 0],
};

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

  useEffect(() => {
    if (!map) return;
    if (!enabled || zoom < STREETSCAPE_ZOOM) {
      setData(EMPTY);
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
        if (!cancelled) {
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
      cancelled = true;
      if (timer) clearTimeout(timer);
      map.off('moveend', schedule);
    };
  }, [map, zoom, enabled]);

  return data;
}
