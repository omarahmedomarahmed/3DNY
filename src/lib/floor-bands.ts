import type {
  Building,
  FloorBand,
  FloorPortion,
  OccupancyKind,
  Space,
  Tenant,
} from '@/types';

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
 * How far each kind of band stands proud of the facade.
 *
 * They are different radii rather than different z, because they can share a
 * floor: a client on 14 and an availability on 14 are two true statements
 * about the same band of wall, and coplanar surfaces at the same radius
 * z-fight into a flickering mess. Availability sits furthest out, which is
 * both the loudest position and the one that wins any overlap.
 */
const BAND_RADIUS: Record<OccupancyKind, { entire: number; partial: number }> = {
  available: { entire: 1.035, partial: 1.02 },
  client: { entire: 1.05, partial: 1.05 },
  occupied: { entire: 1.012, partial: 1.012 },
};

/** One occupancy, before it knows where on the tower it sits. */
export interface FloorClaim {
  recordId: string;
  kind: OccupancyKind;
  /** Lowest floor of the run. */
  floorNumber: number;
  /** How many consecutive floors it covers. One unless merged. */
  floors: number;
  portion: FloorPortion;
  label: string | null;
}

/**
 * Collapses consecutive floors of one tenancy into a single band.
 *
 * A firm on 7 through 14 is one tenancy, and drawing it as eight separate
 * stripes says the opposite — it reads as eight facts, and stacked up the
 * facade it becomes indistinguishable from the building's own floor lines. On
 * a tower with two block tenants the middle of the building turned into a
 * hatch pattern that out-shouted the one Goldenrod band underneath it.
 *
 * One block per tenancy is both quieter and truer.
 */
export function mergeRuns(claims: FloorClaim[]): FloorClaim[] {
  const byRecord = new Map<string, FloorClaim[]>();
  for (const claim of claims) {
    const list = byRecord.get(claim.recordId) ?? [];
    list.push(claim);
    byRecord.set(claim.recordId, list);
  }

  const out: FloorClaim[] = [];
  for (const list of byRecord.values()) {
    const sorted = [...list].sort((a, b) => a.floorNumber - b.floorNumber);
    let run = { ...sorted[0] };
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      if (next.floorNumber === run.floorNumber + run.floors) {
        run.floors += next.floors;
        continue;
      }
      out.push(run);
      run = { ...next };
    }
    out.push(run);
  }
  return out;
}

/**
 * Bands for any set of floor claims on one building.
 *
 * Availability, a client's space and a tenancy are the same geometry problem —
 * put a collar round floor N — and differ only in what they are called and how
 * far out they sit. Keeping one implementation means a floor height fix
 * reaches all three, and it is the floor height that is the estimate here.
 */
export function computeBands(building: Building, claims: FloorClaim[]): FloorBand[] {
  const ring = buildingRing(building);
  if (!ring) return [];

  const { height, derived } = floorHeightFt(building);
  const roof = buildingHeightFt(building);

  return claims
    .filter((c) => c.floorNumber > 0)
    .map((c) => {
      const span = Math.max(1, c.floors);
      let base = (c.floorNumber - 1) * height;
      let top = base + height * span;

      // A floor number beyond the building's known height still has to render
      // somewhere sensible — pin it just below the roof rather than floating.
      if (base > roof) {
        base = Math.max(0, roof - height * span);
        top = roof;
      }

      // A collar just OUTSIDE the facade, not inside it. Inset bands sat within
      // the tower's own opaque walls, so they were invisible in the ordinary
      // view and only appeared with photorealistic mode on, where depth
      // testing is off. Scaling about the centroid keeps the band the exact
      // shape of the building's footprint.
      const radius = BAND_RADIUS[c.kind];
      const factor = c.portion === 'partial' ? radius.partial : radius.entire;

      return {
        recordId: c.recordId,
        kind: c.kind,
        buildingId: building.id,
        floorNumber: c.floorNumber,
        floors: span,
        portion: c.portion,
        label: c.label,
        baseFt: base,
        topFt: top,
        polygon: insetRing(ring, factor),
        approximate: derived,
      } satisfies FloorBand;
    })
    .sort((a, b) => a.floorNumber - b.floorNumber);
}

/** Available space as floor claims. */
export function spaceClaims(spaces: Space[]): FloorClaim[] {
  return spaces
    .filter((s) => s.is_active && s.floor_number !== null && s.floor_number > 0)
    .map((s) => ({
      recordId: s.id,
      kind: 'available' as const,
      floorNumber: s.floor_number as number,
      floors: 1,
      portion: s.floor_portion,
      label: null,
    }));
}

/**
 * Tenancies as floor claims — one per floor a company holds.
 *
 * A tenancy with no readable floor number yields nothing. That is the common
 * case for ground-floor retail and it is deliberately not a guess: the row
 * still exists and still shows in the building's tenant table, it simply is
 * not drawn on a floor nobody stated.
 */
export function tenantClaims(tenants: Tenant[]): FloorClaim[] {
  const out: FloorClaim[] = [];
  for (const t of tenants) {
    const kind: OccupancyKind = t.relationship === 'client' ? 'client' : 'occupied';
    for (const floor of t.floor_numbers ?? []) {
      out.push({
        recordId: t.id,
        kind,
        floorNumber: floor,
        floors: 1,
        // A tenancy is the whole floor unless a suite says otherwise, and a
        // suite is the one signal in the data that says it is not.
        portion: t.suite ? 'partial' : 'entire',
        label: t.company_name,
      });
    }
  }
  // A firm holding 7 through 14 is one tenancy and gets one band.
  return mergeRuns(out);
}

/** Every band on one building: what is available, and who is in the rest. */
export function computeFloorBands(building: Building, spaces: Space[]): FloorBand[] {
  return computeBands(building, spaceClaims(spaces));
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

/**
 * A soft pool on the pavement where a building meets it.
 *
 * With cast shadows off — deck.gl's shadow pass corrupted picking and striped
 * every facade — buildings had nothing anchoring them to the ground and read
 * as floating. This is the trick every architectural render uses instead:
 * concentric rings around the footprint, each slightly larger and fainter, so
 * the darkness falls off with distance. Three rings is enough to read as a
 * gradient and cheap enough to draw for every building on screen.
 *
 * Scaled with height, because a sixty-storey tower occludes far more sky at
 * its base than a six-storey loft does.
 */
export function contactShadowRings(
  building: Building,
): { ring: [number, number][]; opacity: number }[] {
  const ring = buildingRing(building);
  if (!ring) return [];

  const heightFt = buildingHeightFt(building);
  // A tall building gets a wider pool, clamped so a spire does not flood the
  // block and a low-rise still gets something.
  const spread = Math.min(0.075, Math.max(0.022, heightFt / 14_000));

  return [
    { ring: insetRing(ring, 1 + spread * 0.35), opacity: 1 },
    { ring: insetRing(ring, 1 + spread * 0.75), opacity: 0.55 },
    { ring: insetRing(ring, 1 + spread), opacity: 0.25 },
  ];
}
