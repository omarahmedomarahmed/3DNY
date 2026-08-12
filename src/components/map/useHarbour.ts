'use client';

import { useEffect, useState } from 'react';
import type { WaterPolygon } from '@/lib/streetscape';

/**
 * The harbour, fetched once and never again.
 *
 * Every other ground layer is keyed to the viewport, which is right for
 * streets and parks — you can only see what is near you and there are hundreds
 * of thousands of them. Water is the exception, and the reason is that water
 * is what the *horizon* is made of. Clipped to the viewport the Hudson ends in
 * a straight line a few hundred metres out and the island appears to be
 * floating on the same grey plane as the streets, which is the single most
 * conspicuous thing wrong with a wide view.
 *
 * So this asks for one fixed box covering New York harbour, the two rivers and
 * the Kill van Kull, once per page, and it asks the endpoint for water alone —
 * see `only=water`. Every other layer at this extent would be tens of
 * thousands of features nobody is close enough to see.
 *
 * ## Why the box is fixed
 *
 * It could follow the camera, and following the camera would be worse. A fixed
 * box is one request, cached at the edge under one key for everyone, and it
 * never changes shape — so the shoreline never moves, never re-tessellates and
 * never pops. The harbour is not somewhere you can fly out of in this
 * product's Manhattan.
 */

/**
 * West, south, east, north. Battery to the north of Central Park, and from
 * Bayonne to Brooklyn — 0.18° each way, inside the endpoint's own 0.2 ° cap.
 */
const HARBOUR_BBOX: [number, number, number, number] = [-74.09, 40.62, -73.91, 40.80];

export function useHarbour(enabled: boolean): WaterPolygon[] {
  const [water, setWater] = useState<WaterPolygon[]>([]);

  useEffect(() => {
    if (!enabled || water.length > 0) return;

    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/streetscape?only=water&bbox=${HARBOUR_BBOX.join(',')}`,
        );
        if (!res.ok) return;
        const result = (await res.json()) as { water?: WaterPolygon[] };
        if (!cancelled && result.water && result.water.length > 0) {
          setWater(result.water);
        }
      } catch {
        // A missing harbour degrades to the viewport's own water, which is
        // where this started. It is never an error state.
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
    // `water` is in the guard rather than the deps on purpose: this runs once
    // and must not re-run when it succeeds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return water;
}
