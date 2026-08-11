import type { Building } from '@/types';
import { buildingHeightFt, buildingRing, FT_TO_M, insetRing } from '@/lib/floor-bands';
import { fallbackSteps, type Step } from './massing';
import { lod2For, surveyedSectionAt } from './lod2-registry';
import { radiusFromProfile, ringReachM } from './lod2';

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
  /**
   * The surveyed cross-section first, the footprint second.
   *
   * A slice through the city's own model is the building's actual outline at
   * that height, which is the whole of §5's argument delivered. The footprint
   * path stays for the buildings the 2014 capture predates, where a plain
   * prism is the honest answer and the collar is trivially right on it.
   */
  const section = surveyedSectionAt(building.bin, baseFt * FT_TO_M);
  if (section) return insetRing(section, collar);

  const ring = buildingRing(building);
  if (!ring) return null;
  return insetRing(ring, insetForBuilding(building, baseFt) * collar);
}

/**
 * The building's horizontal reach at an elevation, as a fraction of ground.
 *
 * Surveyed first, fallback second, and both in the same units so the renderer
 * and the band builder can share one call. The fallback is not a lesser
 * version of the same thing — it is a guess where the survey is silent, and
 * §5 is explicit that a building the 2014 capture predates falls back rather
 * than being invented.
 */
export function insetForBuilding(building: Building, atFt: number): number {
  const zM = atFt * FT_TO_M;

  const surveyed = lod2For(building.bin)?.profile;
  const ring = buildingRing(building);
  if (surveyed && ring) {
    /**
     * Metres over metres, measured identically on both sides.
     *
     * The surveyed reach comes from the city's model and the footprint comes
     * from the footprints dataset, and the two do not agree about the
     * building's extent at ground level — different surveys, different
     * definitions of where a plinth ends. Dividing the surveyed reach at
     * height by the surveyed reach at ground and applying that to the
     * footprint compounds the disagreement, and put the Empire State
     * Building's bands a fifth of the way inside its own shaft.
     */
    const reach = ringReachM(ring);
    if (reach > 0) {
      const radius = radiusFromProfile(surveyed, zM);
      // Never wider than the plot: a mast housing that reaches further out
      // than the base would otherwise push a band off the building entirely.
      if (radius > 0) return Math.min(1, radius / reach);
    }
  }

  const heightM = buildingHeightFt(building) * FT_TO_M;
  return insetAtHeight(fallbackSteps(heightM, building.year_built), zM);
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
