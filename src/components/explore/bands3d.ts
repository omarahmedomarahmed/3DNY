import * as THREE from 'three';
import type { BuildingWithSpaces, OccupancyKind } from '@/types';
import {
  computeBands,
  spaceClaims,
  tenantClaims,
  FT_TO_M,
  buildingRing,
  type FloorClaim,
} from '@/lib/floor-bands';
import { occupancyColors, selectedSpaceColor, type ColorOverrides } from '../map/colors';
import { bandRingAt, collarOf } from '@/lib/explore/profile';
import { ringToLocal, type LocalFrame } from '@/lib/explore/frame';
import { insetRingLocal, mergeMassings, type MassingArrays } from '@/lib/explore/massing';
import { parapetMassing } from './roofs3d';

/**
 * Availability, drawn in the same buffer as the city.
 *
 * The bands live in deck.gl on the flat map and that is exactly right there.
 * In Explore mode it is not, and the reason is compositing: deck.gl's overlay
 * is a separate canvas stacked above MapLibre's, so a band drawn there has
 * nothing in front of it — including the tower it is wrapped around. Every
 * band showed all four of its sides at once and read as a yellow wireframe
 * box hovering beside the building rather than as a stripe painted on it.
 *
 * That is not a cosmetic complaint. The one rule of this product is that a
 * Goldenrod band on the 14th floor is the loudest thing on screen, and a band
 * that reads as a floating rectangle is *less* legible than one that reads as
 * a floor — you can no longer tell which side of the building it is on.
 *
 * So the visible bands are drawn here, in three.js, in the same depth buffer
 * as the facades. Three properties follow, and all three are the point:
 *
 * | | |
 * |---|---|
 * | They occlude correctly | A band on the far side is behind the building, as it is in life |
 * | They cannot disagree with the facade | The geometry comes from `computeBands`, the same function the flat map calls |
 * | They are still the loudest thing | Unlit, at full Goldenrod, and biased a hair toward the camera so a coplanar wall never wins |
 *
 * deck.gl keeps its own copy, invisible, purely so that clicking a band still
 * opens its space card. Picking runs in its own framebuffer and does not care
 * what alpha a layer was drawn with, so every existing popup, fly-to and
 * compare behaviour carries over untouched.
 */

/** Which kinds of band are drawn, and the selection, as one bundle. */
export interface BandInput {
  buildings: BuildingWithSpaces[];
  kinds: OccupancyKind[];
  selectedSpaceId: string | null;
  theme: 'dark' | 'light';
  colorOverrides?: ColorOverrides;
}

export interface BandGroup {
  /** Stable key, so a colour change does not rebuild geometry that did not. */
  key: string;
  arrays: MassingArrays;
  color: THREE.Color;
}

/**
 * Bands, grouped by the colour they are drawn in.
 *
 * One mesh per colour rather than one per band: a tower with twelve
 * availabilities is one draw call, and the whole loaded market is a handful.
 * At 400 buildings this is the difference between comfortably inside the
 * thousand-draw-call budget and nowhere near it.
 */
export function buildBandGroups(frame: LocalFrame, input: BandInput): BandGroup[] {
  const kinds = new Set(input.kinds);
  const byColor = new Map<string, { color: THREE.Color; parts: MassingArrays[] }>();

  for (const building of input.buildings) {
    const footprint = buildingRing(building);
    if (!footprint) continue;

    const claims: FloorClaim[] = [];
    if (kinds.has('available')) claims.push(...spaceClaims(building.spaces));
    if (kinds.has('client') || kinds.has('occupied')) {
      claims.push(...tenantClaims(building.tenants ?? []).filter((c) => kinds.has(c.kind)));
    }

    for (const band of computeBands(building, claims)) {
      // The collar follows the massing's own width at this height, not the
      // ground footprint — see `profile.ts`, and §5 of the plan for why.
      const collar = collarOf(footprint, band.polygon);
      const ring = bandRingAt(building, band.baseFt, collar) ?? band.polygon;

      const rgba =
        band.kind === 'available' && band.recordId === input.selectedSpaceId
          ? selectedSpaceColor(input.colorOverrides)
          : band.portion === 'partial'
            ? occupancyColors(band.kind, input.theme, input.colorOverrides).partial
            : occupancyColors(band.kind, input.theme, input.colorOverrides).entire;

      const key = rgba.slice(0, 3).join(',');
      let group = byColor.get(key);
      if (!group) {
        group = {
          color: new THREE.Color(rgba[0] / 255, rgba[1] / 255, rgba[2] / 255),
          parts: [],
        };
        byColor.set(key, group);
      }

      /**
       * The stripe's thickness matches the flat map's, floor for floor.
       *
       * A whole floor is nearly the full storey; a part floor is thinner; and
       * for a run of floors the fraction applies to the TOP floor rather than
       * to the run, so an eight-floor tenancy is a block with a gap above it
       * rather than a slab two and a half floors tall. The numbers are the
       * same ones `layers.ts` uses, because a band that is a different
       * thickness in the two modes is a band a broker cannot trust.
       */
      const thickness = BAND_THICKNESS[band.kind];
      const fraction = band.portion === 'partial' ? thickness.partial : thickness.entire;
      const floorFt = (band.topFt - band.baseFt) / Math.max(1, band.floors);
      const heightM = Math.max(0.4, floorFt * (band.floors - 1 + fraction) * FT_TO_M);
      const baseM = band.baseFt * FT_TO_M;

      /**
       * A band is a hollow collar, not a solid prism.
       *
       * A prism carries a lid, and a lid is invisible right up until the
       * collar's ring is materially wider than the wall it belongs to. That
       * happens at ground level on a building with an L-shaped base: the
       * cross-section there is a convex hull, so the ring is wider than the
       * masonry, and the lid became a Goldenrod apron lying on the pavement
       * all round the Empire State Building — visible from any pitched
       * camera, and large enough that a probe six floors up landed on it.
       *
       * The parapet builder already makes exactly the right shape: an outer
       * face, an inner face and a coping between them. Reused rather than
       * rewritten, so a fix to one is a fix to both.
       */
      const outer = ringToLocal(frame, ring);
      group.parts.push(
        parapetMassing(outer, insetRingLocal(outer, 0.97), baseM, heightM),
      );
    }
  }

  return [...byColor.entries()].map(([key, g]) => ({
    key,
    arrays: mergeMassings(g.parts),
    color: g.color,
  }));
}

/** Mirrors `BAND_THICKNESS` in `layers.ts`, deliberately and identically. */
const BAND_THICKNESS: Record<OccupancyKind, { entire: number; partial: number }> = {
  available: { entire: 0.92, partial: 0.55 },
  client: { entire: 0.62, partial: 0.42 },
  occupied: { entire: 0.3, partial: 0.24 },
};

/**
 * Flat colour, no lighting, no haze, no distance falloff.
 *
 * Every other surface in this scene is subject to the sun, the sky and six
 * kilometres of air. A band is subject to none of them: Goldenrod at noon and
 * Goldenrod at midnight, at the end of the block and across the island. That
 * is the hierarchy rule written as a material — the flat map already refuses
 * to haze its bands for exactly the same reason.
 */
export function makeBandMaterial(color: THREE.Color): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    // The collar sits a few centimetres proud of the wall, which at a
    // kilometre is well under a depth-buffer step. The offset is what stops a
    // band dissolving into the facade behind it at distance — the exact
    // failure mode this project cannot ship.
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
    side: THREE.DoubleSide,
  });
  return material;
}
