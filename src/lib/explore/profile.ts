import type { Building } from '@/types';
import { buildingHeightFt, buildingRing, FT_TO_M, insetRing } from '@/lib/floor-bands';
import { fallbackSteps, type Step } from './massing';

/**
 * How wide a building is at a given height.
 *
 * This is the whole argument of §5 of the plan, expressed as a function.
 *
 * A floor band is a collar drawn around a building at an elevation. On a plain
 * extrusion that is trivially right, because the building is the same width all
 * the way up. The moment the massing has a setback in it — which is most of
 * Manhattan, and all of the pre-war stock — a collar drawn on the GROUND
 * footprint hangs in mid-air, metres out from the wall it is supposed to be on.
 * On the Empire State Building a band on floor 63 wraps the base and floats
 * some forty metres away from the tower a broker is pointing at.
 *
 * So a band asks the massing how wide the building is where the band goes,
 * rather than assuming. Today the answer comes from the same stepped profile
 * the fallback massing is built from; in sprint 3 the surveyed LOD2 massing
 * answers it instead, and this function is the seam that makes that a
 * one-line change rather than a rewrite.
 *
 * The flat map never calls this. It draws a plain extrusion, where the ground
 * footprint IS the answer at every height, and its behaviour is unchanged.
 */

/** The inset factor of whichever step contains this height. */
export function insetAtHeight(steps: Step[], zM: number): number {
  for (const step of steps) {
    if (zM <= step.topM) return step.inset;
  }
  // Above the top of the massing — a floor number beyond the building's known
  // height. `computeBands` already pins those just under the roof; matching
  // the topmost step keeps the collar on the wall rather than in the sky.
  return steps.length > 0 ? steps[steps.length - 1].inset : 1;
}

/**
 * The ring a band should be drawn on, for one building at one elevation.
 *
 * `collar` is the radius the flat map already uses to keep the three kinds of
 * band from z-fighting — see BAND_RADIUS in `floor-bands.ts`. It is multiplied
 * through rather than replaced, so an availability band still sits outside a
 * client band on the same floor in Explore mode exactly as it does on the flat
 * map.
 */
export function bandRingAt(
  building: Building,
  baseFt: number,
  collar: number,
): [number, number][] | null {
  const ring = buildingRing(building);
  if (!ring) return null;

  const heightM = buildingHeightFt(building) * FT_TO_M;
  const steps = fallbackSteps(heightM, building.year_built);
  const inset = insetAtHeight(steps, baseFt * FT_TO_M);

  return insetRing(ring, inset * collar);
}

/**
 * The collar factor a band was drawn with, recovered from its own geometry.
 *
 * `computeBands` bakes the collar into the polygon it returns, and Explore
 * mode needs to re-inset that polygon by the massing's profile without losing
 * it. Rather than duplicating the BAND_RADIUS table — which would drift the
 * first time somebody tuned it — the factor is measured back off the ring the
 * band actually carries, against the footprint it came from.
 */
export function collarOf(
  footprint: [number, number][],
  bandRing: [number, number][],
): number {
  if (footprint.length === 0 || bandRing.length !== footprint.length) return 1;

  let cx = 0;
  let cy = 0;
  for (const [x, y] of footprint) {
    cx += x;
    cy += y;
  }
  cx /= footprint.length;
  cy /= footprint.length;

  // The vertex furthest from the centroid gives the best-conditioned ratio;
  // a vertex near the centre divides two very small numbers.
  let best = 0;
  let ratio = 1;
  for (let i = 0; i < footprint.length; i++) {
    const d = Math.hypot(footprint[i][0] - cx, footprint[i][1] - cy);
    if (d > best) {
      best = d;
      ratio = Math.hypot(bandRing[i][0] - cx, bandRing[i][1] - cy) / d;
    }
  }
  return best > 0 ? ratio : 1;
}
