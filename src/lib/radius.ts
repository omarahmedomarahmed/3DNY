import type { BuildingWithSpaces, Space } from '@/types';

/** A point in WGS84 degrees. Buildings carry lon/lat directly. */
export interface LonLat {
  lon: number;
  lat: number;
}

export interface BuildingWithDistance extends BuildingWithSpaces {
  distanceMiles: number;
}

export interface SpaceWithDistance {
  building: BuildingWithSpaces;
  space: Space;
  distanceMiles: number;
}

const EARTH_RADIUS_MILES = 3958.7613;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance in statute miles. Plain haversine — at Manhattan
 * scale this is accurate to a few feet and costs nothing to bundle.
 */
export function milesBetween(a: LonLat, b: LonLat): number {
  if (!isFinitePoint(a) || !isFinitePoint(b)) return Number.POSITIVE_INFINITY;

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

function isFinitePoint(p: LonLat | null | undefined): p is LonLat {
  return (
    !!p &&
    typeof p.lon === 'number' &&
    typeof p.lat === 'number' &&
    Number.isFinite(p.lon) &&
    Number.isFinite(p.lat)
  );
}

/**
 * The point a building sits at: its stored lon/lat, falling back to the
 * centroid of its footprint ring when the geocode never wrote coordinates.
 */
export function buildingCentroid(building: BuildingWithSpaces): LonLat | null {
  if (building.lon !== null && building.lat !== null) {
    const point = { lon: building.lon, lat: building.lat };
    if (isFinitePoint(point)) return point;
  }

  const ring = building.footprint;
  if (!ring || ring.length === 0) return null;

  let lonSum = 0;
  let latSum = 0;
  let n = 0;
  for (const pair of ring) {
    if (!pair || pair.length < 2) continue;
    const [lon, lat] = pair;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    lonSum += lon;
    latSum += lat;
    n++;
  }
  if (n === 0) return null;
  return { lon: lonSum / n, lat: latSum / n };
}

/** Buildings whose centroid falls inside the radius, nearest first. */
export function buildingsWithin(
  buildings: BuildingWithSpaces[],
  center: LonLat,
  miles: number,
): BuildingWithDistance[] {
  if (!Array.isArray(buildings) || !isFinitePoint(center) || !Number.isFinite(miles)) {
    return [];
  }

  const out: BuildingWithDistance[] = [];
  for (const building of buildings) {
    const centroid = buildingCentroid(building);
    if (!centroid) continue;
    const distanceMiles = milesBetween(center, centroid);
    if (distanceMiles > miles) continue;
    out.push({ ...building, distanceMiles });
  }
  return out.sort((a, b) => a.distanceMiles - b.distanceMiles);
}

/** Every active space in range, flattened and sorted by distance. */
export function spacesWithin(
  buildings: BuildingWithSpaces[],
  center: LonLat,
  miles: number,
): SpaceWithDistance[] {
  const out: SpaceWithDistance[] = [];
  for (const building of buildingsWithin(buildings, center, miles)) {
    for (const space of building.spaces ?? []) {
      out.push({ building, space, distanceMiles: building.distanceMiles });
    }
  }
  return out.sort((a, b) => a.distanceMiles - b.distanceMiles);
}
