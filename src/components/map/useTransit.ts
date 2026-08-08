'use client';

import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import {
  snapTransitBbox,
  transitBboxKey,
  type TransitResult,
  type TransitStop,
} from '@/lib/transit';

/**
 * Below this a viewport spans more of the city than one Overpass query should
 * carry, and a thousand bus stops at that size is a smear rather than a map.
 */
export const TRANSIT_ZOOM = 13.2;

const SETTLE_MS = 500;
const PAD = 0.25;
const MAX_SPAN = 0.2;

/**
 * Loads transit stops for whatever is on screen.
 *
 * Same shape as the city-context loader: snapped bboxes, a per-page cache so
 * panning back is free, and silent failure — Overpass is a volunteer service
 * and a bad minute from it must never interrupt a meeting.
 */
export function useTransit(map: maplibregl.Map | null, zoom: number, enabled: boolean) {
  const [stops, setStops] = useState<TransitStop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, TransitStop[]>());
  const inflight = useRef<Set<string>>(new Set());
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!map || !enabled || zoom < TRANSIT_ZOOM) {
      if (!enabled) setError(null);
      setStops([]);
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
      const padX = Math.min((e - w) * PAD, Math.max(0, (MAX_SPAN - (e - w)) / 2));
      const padY = Math.min((n - s) * PAD, Math.max(0, (MAX_SPAN - (n - s)) / 2));

      const snapped = snapTransitBbox([w - padX, s - padY, e + padX, n + padY]);
      const key = transitBboxKey(snapped);

      const cached = cache.current.get(key);
      if (cached) {
        if (!cancelled && lastKey.current !== key) {
          lastKey.current = key;
          setStops(cached);
        }
        return;
      }
      if (inflight.current.has(key)) return;
      inflight.current.add(key);

      try {
        const res = await fetch(`/api/transit?bbox=${snapped.join(',')}`);
        if (!res.ok) {
          if (!cancelled) setError('Transit data is unavailable right now.');
          return;
        }
        const data = (await res.json()) as TransitResult;
        cache.current.set(key, data.stops);
        if (!cancelled) {
          setError(null);
          lastKey.current = key;
          setStops(data.stops);
        }
      } catch {
        if (!cancelled) setError('Transit data could not be loaded.');
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

  return { stops, error };
}
