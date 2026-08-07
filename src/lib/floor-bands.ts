import type { Building, FloorBand, Space } from '@/types';

/**
 * Turns "the 45th floor is available" into a coloured band on the tower.
 *
 * Honest about what it knows:
 *   - which building  → exact (matched to BIN)
 *   - which floor     → exact (straight from the sheet)
 *   - where that floor sits vertically → derived from building height divided
 *     by floor count, so within about one floor on towers with mechanical
 *     levels, double-height lobbies or setbacks.
 *
 * `floor_height_override` on a building replaces the derived value when a
 * specific tower matters enough to measure.
 */

/** Typical Manhattan office floor-to-floor, used when PLUTO data is missing. */
export const DEFAULT_FLOOR_HEIGHT_FT = 12.5;

export function floorHeightFt(building: Building): {
  height: number;
  derived: boolean;
} {
  if (building.floor_height_override && building.floor_height_override > 0) {
    return { height: building.floor_height_override, derived: false };
  }
  if (
    building.height_roof_ft &&
    building.num_floors &&
    building.num_floors > 0 &&
    building.height_roof_ft > 0
  ) {
    const h = building.height_roof_ft / building.num_floors;
    // Guard against bad source data producing absurd floor heights.
    if (h >= 8 && h <= 30) return { height: h, derived: true };
  }
  return { height: DEFAULT_FLOOR_HEIGHT_FT, derived: true };
}

/**
 * Shrinks a footprint ring toward its centroid so the band reads as a stripe
 * wrapped around the tower rather than a re-skin of the whole facade.
 */
export function insetRing(
  ring: [number, number][],
  factor = 0.94,
): [number, number][] {
  if (ring.length === 0) return ring;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  const cx = sx / ring.length;
  const cy = sy / ring.length;
  return ring.map(([x, y]) => [
    cx + (x - cx) * factor,
    cy + (y - cy) * factor,
  ]) as [number, number][];
}

/**
 * Falls back to a small square around the building centroid when the footprint
 * polygon has not been joined yet, so a newly imported building still shows
 * something clickable on the map.
 */
export function fallbackRing(
  lon: number,
  lat: number,
  meters = 22,
): [number, number][] {
  const dLat = meters / 111_320;
  const dLon = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ];
}

export function buildingRing(building: Building): [number, number][] | null {
  if (building.footprint && building.footprint.length >= 4) return building.footprint;
  if (building.lon !== null && building.lat !== null) {
    return fallbackRing(building.lon, building.lat);
  }
  return null;
}

/** Total building height, preferring measured roof height. */
export function buildingHeightFt(building: Building): number {
  if (building.height_roof_ft && building.height_roof_ft > 0) {
    return building.height_roof_ft;
  }
  const { height } = floorHeightFt(building);
  return (building.num_floors ?? 10) * height;
}

/**
 * One band per available floor. Partial floors are rendered slightly narrower
 * so "Partial 11th" and "Entire 11th" are distinguishable at a glance.
 */
export function computeFloorBands(
  building: Building,
  spaces: Space[],
): FloorBand[] {
  const ring = buildingRing(building);
  if (!ring) return [];

  const { height, derived } = floorHeightFt(building);
  const roof = buildingHeightFt(building);

  return spaces
    .filter((s) => s.is_active && s.floor_number !== null && s.floor_number > 0)
    .map((s) => {
      const floor = s.floor_number as number;
      let base = (floor - 1) * height;
      let top = base + height;

      // A floor number beyond the building's known height still has to render
      // somewhere sensible — pin it just below the roof rather than floating.
      if (base > roof) {
        base = Math.max(0, roof - height);
        top = roof;
      }

      // A collar just OUTSIDE the facade, not inside it. Inset bands sat within
      // the tower's own opaque walls, so they were invisible in the ordinary
      // view and only appeared with photorealistic mode on, where depth
      // testing is off. Scaling about the centroid keeps the band the exact
      // shape of the building's footprint.
      const factor = s.floor_portion === 'partial' ? 1.02 : 1.035;

      return {
        spaceId: s.id,
        buildingId: building.id,
        floorNumber: floor,
        portion: s.floor_portion,
        baseFt: base,
        topFt: top,
        polygon: insetRing(ring, factor),
        approximate: derived,
      } satisfies FloorBand;
    })
    .sort((a, b) => a.floorNumber - b.floorNumber);
}

/** Feet → metres, which is what deck.gl's elevation units expect. */
export const FT_TO_M = 0.3048;

/** One drawn floor line on a facade. */
export interface FloorLine {
  buildingId: string;
  floorNumber: number;
  /** Feet above ground of the floor plate. */
  baseFt: number;
  polygon: [number, number][];
}

/**
 * Beyond this many floors the lines stop being readable and start being cost.
 * No Manhattan office tower in the sheet comes close, but bad source data can.
 */
const MAX_DRAWN_FLOORS = 120;

/**
 * Every floor plate of a building, as a thin ring around the facade.
 *
 * This is what turns a coloured extrusion into something that reads as a
 * building: a stack of floors you can count, at the building's own derived
 * floor height, so a Goldenrod availability band lands exactly on the line for
 * the floor the sheet named. Purely a skin — never pickable, never coloured by
 * data, and one shade off the facade so it never competes with availability.
 */
export function computeFloorLines(building: Building): FloorLine[] {
  const ring = buildingRing(building);
  if (!ring) return [];

  const { height } = floorHeightFt(building);
  if (height <= 0) return [];

  const roof = buildingHeightFt(building);
  const count = Math.min(Math.floor(roof / height), MAX_DRAWN_FLOORS);
  if (count < 2) return [];

  // Just proud of the wall, and well inside the availability collar, so the
  // three surfaces never fight for the same depth.
  const skin = insetRing(ring, 1.0015);

  const lines: FloorLine[] = [];
  for (let floor = 1; floor < count; floor++) {
    lines.push({
      buildingId: building.id,
      floorNumber: floor + 1,
      baseFt: floor * height,
      polygon: skin,
    });
  }
  return lines;
}
