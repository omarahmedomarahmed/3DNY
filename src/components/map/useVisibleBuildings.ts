'use client';

import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { useApp } from '@/lib/store';
import type { BuildingWithSpaces } from '@/types';

const DEBOUNCE_MS = 150;

/**
 * Keeps the store's `visibleBuildingIds` in step with the map viewport. The
 * sidebar list is driven by this, so it has to follow both pan and zoom, but
 * recomputing on every animation frame during a fly-to would thrash the store.
 */
export function useVisibleBuildings(
  map: maplibregl.Map | null,
  buildings: BuildingWithSpaces[],
): void {
  const setVisibleBuildingIds = useApp((s) => s.setVisibleBuildingIds);

  useEffect(() => {
    if (!map) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastKey = '';

    const compute = () => {
      timer = null;
      let bounds: maplibregl.LngLatBounds;
      try {
        bounds = map.getBounds();
      } catch {
        return;
      }
      const west = bounds.getWest();
      const east = bounds.getEast();
      const south = bounds.getSouth();
      const north = bounds.getNorth();

      const ids: string[] = [];
      for (const b of buildings) {
        if (b.lon === null || b.lat === null) continue;
        if (b.lat < south || b.lat > north) continue;
        // Guard the antimeridian case rather than assuming west < east.
        const inLon =
          west <= east
            ? b.lon >= west && b.lon <= east
            : b.lon >= west || b.lon <= east;
        if (inLon) ids.push(b.id);
      }

      const key = ids.join('|');
      if (key === lastKey) return;
      lastKey = key;
      setVisibleBuildingIds(ids);
    };

    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(compute, DEBOUNCE_MS);
    };

    // Run once for the initial viewport, then follow interaction.
    schedule();
    map.on('move', schedule);
    map.on('zoom', schedule);
    map.on('moveend', schedule);
    map.on('zoomend', schedule);

    return () => {
      if (timer !== null) clearTimeout(timer);
      map.off('move', schedule);
      map.off('zoom', schedule);
      map.off('moveend', schedule);
      map.off('zoomend', schedule);
    };
  }, [map, buildings, setVisibleBuildingIds]);
}

export default useVisibleBuildings;
