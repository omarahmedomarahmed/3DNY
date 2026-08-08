import { bboxClip } from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { snapBbox } from './city-context';
import { metersBetween } from './transit';

/**
 * The ground the city stands on — real street geometry and real water, from
 * NYC's planimetric surveys, drawn as our own 3D ground plane instead of a
 * flat basemap image underneath the buildings.
 *
 * Two sources, both free and keyless:
 *   - Centerline (inkn-q76z): every street segment with its measured roadbed
 *     width, so an avenue is drawn wide and an alley narrow, plus the street
 *     name — which becomes the painted-on-the-asphalt name at close zoom.
 *   - Planimetric hydrography (pjs3-c3z5): the rivers, drawn as polygons so
 *     the island reads as an island once our opaque ground covers the basemap.
 *
 * Sidewalks are derived from the centerline rather than fetched: the
 * planimetric sidewalk dataset costs ~5MB per viewport cell before
 * simplification, and a band extending from the kerb reads identically at
 * map scale for zero bytes.
 */

const CENTERLINE = 'https://data.cityofnewyork.us/resource/inkn-q76z.json';
const HYDROGRAPHY = 'https://data.cityofnewyork.us/resource/pjs3-c3z5.json';

/** Above this many road segments the request is truncated, widest first. */
export const ROAD_LIMIT = 6000;

/**
 * Road tiers, which drive width fallbacks, colour and level-of-detail:
 * 0 = highway/bridge/ramp, 1 = avenue-wide, 2 = ordinary street, 3 = alley.
 */
export type RoadTier = 0 | 1 | 2 | 3;

export interface RoadSegment {
  /** Polyline, [lon, lat] rounded to ~11cm. */
  p: [number, number][];
  /** Roadbed width in feet, kerb to kerb. */
  w: number;
  t: RoadTier;
  /** Street name as painted on the ground, or null for unnamed segments. */
  n: string | null;
}

export interface WaterPolygon {
  /** First ring is the shore; the rest are holes — islands stay dry. */
  rings: [number, number][][];
}

export interface StreetscapeResult {
  roads: RoadSegment[];
  water: WaterPolygon[];
  truncated: boolean;
  bbox: [number, number, number, number];
}

/**
 * CSCL `rw_type` codes that are drawable road surface. Tunnels are
 * deliberately absent — drawing the Queens–Midtown approach across the East
 * River bed is how a map stops being trusted. Paths, step streets, driveways
 * and paper streets are noise at this scale.
 */
const DRAWABLE_RW_TYPES = new Set(['1', '2', '3', '9', '10']);

/** rw_type: 2 highway, 3 bridge, 9 ramp. */
const ELEVATED_RW_TYPES = new Set(['2', '3', '9']);

export function roadTier(rwType: string, widthFt: number): RoadTier {
  if (ELEVATED_RW_TYPES.has(rwType)) return 0;
  if (widthFt >= 56) return 1;
  if (widthFt >= 30) return 2;
  return 3;
}

/**
 * Manhattan roadbeds run ~34ft (side streets) to ~100ft (Park Avenue).
 * Widths outside plausibility are survey artefacts, not boulevards.
 */
export function clampRoadWidth(raw: number | null): number {
  if (raw === null || !Number.isFinite(raw) || raw <= 0) return 30;
  return Math.min(120, Math.max(16, raw));
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Same collinear-vertex dropper the building footprints use. */
function simplifyLine(line: [number, number][], tol: number): [number, number][] {
  if (line.length <= 2) return line;
  const out: [number, number][] = [line[0]];
  for (let i = 1; i < line.length - 1; i++) {
    const [ax, ay] = out[out.length - 1];
    const [bx, by] = line[i];
    const [cx, cy] = line[i + 1];
    const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
    const base = Math.hypot(cx - ax, cy - ay);
    if (base === 0 || area / base > tol) out.push(line[i]);
  }
  out.push(line[line.length - 1]);
  return out;
}

function headers(): Record<string, string> {
  const token = process.env.NYC_OPEN_DATA_APP_TOKEN;
  return token ? { 'X-App-Token': token } : {};
}

/** Every LineString in a LineString or MultiLineString geometry. */
function lineParts(geom: any): [number, number][][] {
  if (!geom) return [];
  const lines: any[] =
    geom.type === 'MultiLineString'
      ? geom.coordinates
      : geom.type === 'LineString'
        ? [geom.coordinates]
        : [];
  return lines
    .filter((l: any) => Array.isArray(l) && l.length >= 2)
    .map((l: any) => l.map((p: number[]) => [p[0], p[1]] as [number, number]));
}

async function fetchRoads(
  polygon: string,
): Promise<{ roads: RoadSegment[]; truncated: boolean }> {
  const url =
    `${CENTERLINE}?$select=the_geom,streetwidth,rw_type,stname_label` +
    `&$where=intersects(the_geom,'${polygon}')` +
    `&$order=streetwidth DESC` +
    `&$limit=${ROAD_LIMIT}`;

  const res = await fetch(url, {
    headers: headers(),
    // Street geometry changes on the timescale of urban planning, not news.
    next: { revalidate: 604800 },
  });
  if (!res.ok) throw new Error(`NYC centerline returned ${res.status}.`);

  const records = (await res.json()) as any[];
  const roads: RoadSegment[] = [];

  for (const rec of records) {
    const rwType = String(rec.rw_type ?? '').trim();
    if (!DRAWABLE_RW_TYPES.has(rwType)) continue;

    const width = clampRoadWidth(num(rec.streetwidth));
    const tier = roadTier(rwType, width);
    const name =
      typeof rec.stname_label === 'string' && rec.stname_label.trim()
        ? rec.stname_label.trim()
        : null;

    for (const part of lineParts(rec.the_geom)) {
      roads.push({
        p: simplifyLine(part, 0.00002).map(
          ([lon, lat]) => [round6(lon), round6(lat)] as [number, number],
        ),
        w: width,
        t: tier,
        n: name,
      });
    }
  }

  return { roads, truncated: records.length >= ROAD_LIMIT };
}

async function fetchWater(
  polygon: string,
  bbox: [number, number, number, number],
): Promise<WaterPolygon[]> {
  const url =
    `${HYDROGRAPHY}?$select=the_geom` +
    `&$where=intersects(the_geom,'${polygon}')` +
    `&$limit=200`;

  const res = await fetch(url, {
    headers: headers(),
    next: { revalidate: 604800 },
  });
  if (!res.ok) throw new Error(`NYC hydrography returned ${res.status}.`);

  const records = (await res.json()) as any[];
  const water: WaterPolygon[] = [];

  // The rivers are single enormous polygons that continue far beyond any
  // viewport; clipped to a padded bbox so the payload carries only the water
  // that can actually be seen. Holes are kept — Roosevelt Island is a hole in
  // the East River, and dropping it would flood it.
  const pad = 0.02;
  const clipBox: [number, number, number, number] = [
    bbox[0] - pad,
    bbox[1] - pad,
    bbox[2] + pad,
    bbox[3] + pad,
  ];

  for (const rec of records) {
    const geom = rec.the_geom;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
    let clipped: Feature<Polygon | MultiPolygon>;
    try {
      // bboxClip's signature admits line output for line input; polygon input
      // always yields polygon output, so the narrowing is safe.
      clipped = bboxClip(
        { type: 'Feature', properties: {}, geometry: geom } as Feature<
          Polygon | MultiPolygon
        >,
        clipBox,
      ) as Feature<Polygon | MultiPolygon>;
    } catch {
      continue;
    }

    const polys =
      clipped.geometry.type === 'MultiPolygon'
        ? clipped.geometry.coordinates
        : [clipped.geometry.coordinates];

    for (const poly of polys) {
      const rings = poly
        .filter((ring) => Array.isArray(ring) && ring.length >= 4)
        .map((ring) =>
          simplifyLine(
            ring.map((p) => [p[0], p[1]] as [number, number]),
            0.00004,
          ).map(([lon, lat]) => [round6(lon), round6(lat)] as [number, number]),
        )
        .filter((ring) => ring.length >= 4);
      if (rings.length > 0) water.push({ rings });
    }
  }

  return water;
}

export async function fetchStreetscape(
  rawBbox: [number, number, number, number],
): Promise<StreetscapeResult> {
  const bbox = snapBbox(rawBbox);
  const [w, s, e, n] = bbox;
  const polygon = `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;

  // Water failing must not take the streets down with it, or vice versa: the
  // ground plane with one of the two is still far better than neither.
  const [roadsResult, waterResult] = await Promise.allSettled([
    fetchRoads(polygon),
    fetchWater(polygon, bbox),
  ]);

  if (roadsResult.status === 'rejected' && waterResult.status === 'rejected') {
    throw new Error(String((roadsResult.reason as Error).message));
  }

  return {
    roads: roadsResult.status === 'fulfilled' ? roadsResult.value.roads : [],
    water: waterResult.status === 'fulfilled' ? waterResult.value : [],
    truncated: roadsResult.status === 'fulfilled' ? roadsResult.value.truncated : false,
    bbox,
  };
}

// ---------------------------------------------------------------------------
// Painted street names — geometry solved here so it can be unit-tested.
// ---------------------------------------------------------------------------

export interface StreetNameLabel {
  position: [number, number];
  /** Degrees CCW from east, normalised to (-90, 90] so text is never upside down. */
  angle: number;
  text: string;
  tier: RoadTier;
}

/** Total length of a polyline in metres. */
export function polylineMeters(line: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += metersBetween(line[i - 1], line[i]);
  return total;
}

/**
 * The point halfway along a polyline by arc length, plus the direction of the
 * segment it falls on. Midpoint by arc length, not by vertex index: centerline
 * vertices cluster at curves, and a vertex-index midpoint slides toward them.
 */
export function polylineMidpoint(line: [number, number][]): {
  point: [number, number];
  angle: number;
} {
  const half = polylineMeters(line) / 2;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const seg = metersBetween(line[i - 1], line[i]);
    if (walked + seg >= half && seg > 0) {
      const t = (half - walked) / seg;
      const [ax, ay] = line[i - 1];
      const [bx, by] = line[i];
      return {
        point: [ax + (bx - ax) * t, ay + (by - ay) * t],
        angle: segmentAngle(line[i - 1], line[i]),
      };
    }
    walked += seg;
  }
  const last = line[line.length - 1];
  return { point: last, angle: 0 };
}

/**
 * Angle of a segment in degrees CCW from east, corrected for latitude so a
 * street that runs true north-east is drawn at 45° rather than skewed by the
 * aspect ratio of degrees. Normalised to (-90, 90]: painted text has a fixed
 * world orientation — like real thermoplastic road lettering — and this is the
 * half-plane that reads left-to-right at the map's default bearing.
 */
export function segmentAngle(a: [number, number], b: [number, number]): number {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  const dy = b[1] - a[1];
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg <= -90) deg += 180;
  return deg;
}

/** Which tier wins a contested spot, low first. Highways come last. */
const NAME_PRIORITY: Record<RoadTier, number> = { 1: 0, 2: 1, 3: 2, 0: 3 };

/**
 * Chooses where street names are painted.
 *
 * One name per street roughly every `repeatMeters`, longest segments first so
 * the name lands on the block face with room for it, and a global spacing so
 * two different names never collide at an intersection. Grid-hash rather than
 * pairwise, so it stays O(n) for a few thousand segments.
 */
export function layoutStreetNames(
  roads: RoadSegment[],
  opts: { repeatMeters?: number; clearMeters?: number; minSegmentMeters?: number } = {},
): StreetNameLabel[] {
  const { repeatMeters = 420, clearMeters = 80, minSegmentMeters = 55 } = opts;

  const named = roads
    .filter((r) => r.n && r.p.length >= 2)
    .map((r) => ({ road: r, meters: polylineMeters(r.p) }))
    .filter((r) => r.meters >= minSegmentMeters)
    // Avenue first, then street, then lane — and the highway last of all.
    // Sorting by tier number instead would put tier 0 first, which spends the
    // whole label budget on "FDR DRIVE SB ENTRANCE E 34 ST" while Park Avenue
    // goes unnamed. A broker names avenues and cross-streets; a ramp is the
    // least useful word this map can paint on itself.
    .sort((a, b) => NAME_PRIORITY[a.road.t] - NAME_PRIORITY[b.road.t] || b.meters - a.meters);

  const labels: StreetNameLabel[] = [];
  // ~1.1km cells; every check looks at the surrounding 3×3 block.
  const CELL = 0.01;
  const placedByName = new Map<string, [number, number][]>();
  const grid = new Map<string, [number, number][]>();

  const cellKey = (lon: number, lat: number) =>
    `${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`;

  const tooClose = (
    point: [number, number],
    candidates: [number, number][] | undefined,
    limit: number,
  ) => candidates?.some((p) => metersBetween(p, point) < limit) ?? false;

  for (const { road } of named) {
    const name = road.n as string;
    const { point, angle } = polylineMidpoint(road.p);

    if (tooClose(point, placedByName.get(name), repeatMeters)) continue;

    let blocked = false;
    const cx = Math.floor(point[0] / CELL);
    const cy = Math.floor(point[1] / CELL);
    for (let dx = -1; dx <= 1 && !blocked; dx++) {
      for (let dy = -1; dy <= 1 && !blocked; dy++) {
        blocked = tooClose(point, grid.get(`${cx + dx},${cy + dy}`), clearMeters);
      }
    }
    if (blocked) continue;

    labels.push({ position: point, angle, text: name, tier: road.t });
    const byName = placedByName.get(name) ?? [];
    byName.push(point);
    placedByName.set(name, byName);
    const cell = grid.get(cellKey(point[0], point[1])) ?? [];
    cell.push(point);
    grid.set(cellKey(point[0], point[1]), cell);
  }

  return labels;
}
