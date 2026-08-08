import type { Building } from '@/types';
import { buildingHeightFt, buildingRing, floorHeightFt, insetRing } from './floor-bands';

/**
 * What happens at the top of a building.
 *
 * Manhattan's skyline is silhouette. Every tower on this map used to end in a
 * flat lid, which is the single thing that most gave away that it was a chart
 * rather than a city. Nothing here is surveyed — NYC publishes roof height, not
 * roof furniture — so it is *derived*: from the footprint, the height, the
 * floor count and, above all, the year built.
 *
 * That last one is what makes this honest rather than decorative. A 1913 loft
 * building really does carry a timber water tank on a steel frame and a heavy
 * cornice; a 1963 tower really does end in a blank mechanical slab; a 1983
 * tower really does have a crisp low parapet and a window-washing mast. Those
 * are era facts, not invention, and applying them from `year_built` means a
 * 1920s tower and a 2015 tower no longer end the same way.
 *
 * Everything is deterministic — seeded from the building's own identity — so a
 * tower looks the same on every reload, on every machine, in every meeting.
 * A roof that reshuffled itself between two screenshots of the same building
 * would be worse than a flat lid.
 *
 * Nothing here is ever coloured by data and nothing here is ever pickable.
 * Roof furniture is silhouette; availability is Goldenrod. They must never be
 * confused, and at this map's reading distance a roof detail is a few pixels
 * against a band that is the whole width of the tower.
 */

/** Feet of roof furniture that a floor band must never be confused with. */
export type RoofEra = 'prewar' | 'midcentury' | 'modern';

export interface ParapetBand {
  /** Outer ring then inner ring — a wall, not a lid. */
  rings: [number, number][][];
  baseFt: number;
  heightFt: number;
}

export interface RoofBox {
  ring: [number, number][];
  baseFt: number;
  heightFt: number;
}

export interface RoofCylinder {
  center: [number, number];
  radiusM: number;
  baseFt: number;
  heightFt: number;
}

export interface Roofscape {
  era: RoofEra;
  /** The low wall around the roof edge. Every building has one. */
  parapet: ParapetBand | null;
  /** Stepped tiers below the crown, on tall pre-war towers. */
  setbacks: ParapetBand[];
  /** Mechanical plant and stair bulkheads. */
  bulkheads: RoofBox[];
  /** Timber water tanks on their frames — the pre-war signature. */
  tanks: RoofCylinder[];
  /** The legs under a tank, and window-washing masts. */
  posts: RoofCylinder[];
}

/**
 * Pre-war ends in 1945 and the modern era begins around 1980 — the two
 * genuine breaks in how New York finished a building. The 1916 zoning
 * resolution put setbacks on everything tall before the war; post-war
 * curtain-wall towers replaced the crown with a mechanical slab; by the
 * eighties the plant was inside a designed enclosure again.
 */
export function roofEra(yearBuilt: number | null): RoofEra {
  if (yearBuilt === null || !Number.isFinite(yearBuilt)) return 'midcentury';
  if (yearBuilt < 1945) return 'prewar';
  if (yearBuilt < 1980) return 'midcentury';
  return 'modern';
}

/**
 * A small deterministic hash of a string, in [0, 1).
 *
 * Roof furniture has to be stable: the same building must produce the same
 * roof on every render, every reload and every machine, or a broker taking two
 * screenshots of one tower gets two different buildings. So every "random"
 * choice below is a function of the building's own identity.
 */
export function seededUnit(key: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Two rounds of avalanche, so adjacent BINs do not produce adjacent values.
  h ^= h >>> 13;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Metres per degree of longitude at a given latitude. */
function metersPerDegLon(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

/**
 * Average of the ring vertices — close enough to a centroid at this scale.
 *
 * A closed ring repeats its first vertex as its last, and counting that vertex
 * twice drags the mean several metres toward one corner. That is enough to put
 * a water tank visibly off-centre on a small footprint, so the closing vertex
 * is dropped before averaging.
 */
export function ringCentroid(ring: [number, number][]): [number, number] {
  const n = ringSpan(ring);
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += ring[i][0];
    sy += ring[i][1];
  }
  return [sx / n, sy / n];
}

/** Vertex count excluding a repeated closing vertex. */
function ringSpan(ring: [number, number][]): number {
  const n = ring.length;
  if (n < 2) return n;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[n - 1];
  return fx === lx && fy === ly ? n - 1 : n;
}

/**
 * A representative footprint radius in metres: the mean distance from the
 * centroid to the vertices. Mean rather than max, so one long spur on an
 * L-shaped lot does not report the building as twice its real size.
 */
export function ringRadiusM(ring: [number, number][]): number {
  const [cx, cy] = ringCentroid(ring);
  const mLon = metersPerDegLon(cy);
  const n = ringSpan(ring);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const dx = (ring[i][0] - cx) * mLon;
    const dy = (ring[i][1] - cy) * 111_320;
    total += Math.hypot(dx, dy);
  }
  return total / n;
}

/** A square of side `2 * halfM` metres, centred on a point. */
export function squareAround(
  center: [number, number],
  halfM: number,
): [number, number][] {
  const [lon, lat] = center;
  const dLat = halfM / 111_320;
  const dLon = halfM / metersPerDegLon(lat);
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ];
}

/** Moves a point `distM` metres along `angleRad`, measured CCW from east. */
export function offsetMeters(
  center: [number, number],
  distM: number,
  angleRad: number,
): [number, number] {
  const [lon, lat] = center;
  return [
    lon + (Math.cos(angleRad) * distM) / metersPerDegLon(lat),
    lat + (Math.sin(angleRad) * distM) / 111_320,
  ];
}

/** Parapet height in feet, by era. Pre-war cornices are heavy; modern are not. */
const PARAPET_FT: Record<RoofEra, number> = {
  prewar: 4.2,
  midcentury: 3.0,
  modern: 2.4,
};

/** How far the parapet wall stands in from the facade, as a scale factor. */
const PARAPET_INSET = 0.955;

/**
 * Below this a building is a low-rise whose roof is read from above rather
 * than in silhouette, so it gets a parapet and plant but no crown.
 */
const TOWER_FT = 220;

/** Pre-war towers above this get the stepped 1916-zoning crown. */
const SETBACK_FT = 330;

export function computeRoofscape(building: Building): Roofscape {
  const ring = buildingRing(building);
  const era = roofEra(building.year_built);
  const empty: Roofscape = { era, parapet: null, setbacks: [], bulkheads: [], tanks: [], posts: [] };
  if (!ring) return empty;

  const roofFt = buildingHeightFt(building);
  if (!Number.isFinite(roofFt) || roofFt <= 0) return empty;

  // Seeded from the building's own identity, so the roof never reshuffles.
  const key = building.bin ?? building.id;
  const rnd = (salt: number) => seededUnit(key, salt);

  const radiusM = ringRadiusM(ring);
  const center = ringCentroid(ring);
  const { height: floorFt } = floorHeightFt(building);

  const parapetFt = PARAPET_FT[era];
  const parapet: ParapetBand = {
    rings: [insetRing(ring, PARAPET_INSET), insetRing(ring, PARAPET_INSET - 0.055)],
    baseFt: roofFt,
    heightFt: parapetFt,
  };

  const setbacks: ParapetBand[] = [];
  const bulkheads: RoofBox[] = [];
  const tanks: RoofCylinder[] = [];
  const posts: RoofCylinder[] = [];

  // --- The crown. Pre-war towers step in; post-war towers do not.
  if (era === 'prewar' && roofFt >= SETBACK_FT) {
    // Two tiers, each a storey or two tall and stepped well in — the shape the
    // 1916 zoning resolution produced on every tall tower of the period.
    const tiers = roofFt >= 600 ? 3 : 2;
    let tierBase = roofFt;
    let scale = 0.78;
    for (let i = 0; i < tiers; i++) {
      const tierFt = floorFt * (1.4 + rnd(i + 11) * 1.2);
      setbacks.push({
        rings: [insetRing(ring, scale), insetRing(ring, scale - 0.06)],
        baseFt: tierBase,
        heightFt: tierFt,
      });
      // A solid cap on the tier, so the step reads as mass rather than as a
      // hollow collar seen from above.
      bulkheads.push({
        ring: insetRing(ring, scale - 0.06),
        baseFt: tierBase,
        heightFt: tierFt * 0.96,
      });
      tierBase += tierFt;
      scale *= 0.68;
    }
    // The finial: a slender mast, which is what a 1920s crown ends in.
    posts.push({
      center,
      radiusM: Math.max(0.7, radiusM * 0.045),
      baseFt: tierBase,
      heightFt: roofFt * (0.05 + rnd(31) * 0.05),
    });
  }

  // --- Mechanical plant. Every building has some; the era decides its shape.
  if (era === 'midcentury') {
    // The blank slab bulkhead: large, central, and the whole reason a post-war
    // tower reads as ending in a box rather than a crown.
    const halfM = Math.max(3, radiusM * (0.42 + rnd(3) * 0.12));
    bulkheads.push({
      ring: squareAround(offsetMeters(center, radiusM * 0.06, rnd(4) * Math.PI * 2), halfM),
      baseFt: roofFt + parapetFt * 0.4,
      heightFt: floorFt * (1.1 + rnd(5) * 0.9),
    });
    if (roofFt >= TOWER_FT) {
      // The lift overrun, standing proud of the plant room beside it.
      bulkheads.push({
        ring: squareAround(
          offsetMeters(center, radiusM * (0.2 + rnd(6) * 0.2), rnd(7) * Math.PI * 2),
          Math.max(2, halfM * 0.42),
        ),
        baseFt: roofFt + parapetFt * 0.4,
        heightFt: floorFt * (1.9 + rnd(8) * 0.8),
      });
    }
  } else if (era === 'modern') {
    // Plant inside a designed enclosure: smaller, crisper, set back from the
    // parapet, and usually paired with a window-washing mast.
    const halfM = Math.max(2.5, radiusM * (0.3 + rnd(9) * 0.1));
    bulkheads.push({
      ring: squareAround(center, halfM),
      baseFt: roofFt + parapetFt * 0.3,
      heightFt: floorFt * (0.9 + rnd(10) * 0.7),
    });
    if (roofFt >= TOWER_FT) {
      posts.push({
        center: offsetMeters(center, radiusM * 0.45, rnd(12) * Math.PI * 2),
        radiusM: Math.max(0.4, radiusM * 0.03),
        baseFt: roofFt + parapetFt,
        heightFt: floorFt * (1.6 + rnd(13) * 1.4),
      });
    }
  } else {
    // Pre-war: a modest brick stair bulkhead, off to one side.
    const halfM = Math.max(2.2, radiusM * (0.22 + rnd(14) * 0.1));
    bulkheads.push({
      ring: squareAround(
        offsetMeters(center, radiusM * (0.25 + rnd(15) * 0.25), rnd(16) * Math.PI * 2),
        halfM,
      ),
      baseFt: roofFt,
      heightFt: floorFt * (0.85 + rnd(17) * 0.5),
    });
  }

  // --- Water tanks. The pre-war signature, and the single detail that most
  // says "New York" from any angle. Gravity tanks were required above roughly
  // six storeys, and survive overwhelmingly on pre-war stock.
  if (era === 'prewar' && (building.num_floors ?? roofFt / floorFt) >= 6) {
    const count = radiusM > 34 && rnd(18) > 0.45 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const angle = rnd(20 + i * 3) * Math.PI * 2;
      const at = offsetMeters(center, radiusM * (0.3 + rnd(21 + i * 3) * 0.3), angle);
      const tankR = Math.max(1.8, Math.min(4.2, radiusM * 0.13));
      // The frame the tank stands on, which is most of what you see in a
      // silhouette — a tank sitting flat on a roof reads as a chimney.
      const legFt = 12 + rnd(22 + i * 3) * 10;
      posts.push({
        center: at,
        radiusM: tankR * 0.72,
        baseFt: roofFt,
        heightFt: legFt,
      });
      tanks.push({
        center: at,
        radiusM: tankR,
        baseFt: roofFt + legFt,
        heightFt: tankR * 2.6,
      });
    }
  }

  return { era, parapet, setbacks, bulkheads, tanks, posts };
}
