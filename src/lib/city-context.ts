/**
 * The surrounding city — every other building in view, as real footprints and
 * real roof heights from NYC Open Data.
 *
 * Without this the map is seventeen towers floating in a void, which reads as a
 * diagram. With it, the same towers sit inside Manhattan and a broker can
 * recognise the block before anyone reads a label. That is the entire purpose:
 * context massing is never clicked, never coloured and never labelled.
 *
 * Source: Building Footprints (5zhs-2jue), free and keyless. The survey is a
 * 2014 aerial capture, so a handful of newer towers are missing or short — for
 * background massing that is an acceptable trade, and the buildings that carry
 * data get their heights from the enrichment path instead.
 */

const FOOTPRINTS = 'https://data.cityofnewyork.us/resource/5zhs-2jue.json';

/** Above this many features the request is truncated rather than made slow. */
export const CONTEXT_LIMIT = 6000;

/** Manhattan's median-ish massing, used when a footprint has no roof height. */
const FALLBACK_HEIGHT_FT = 55;

export interface ContextBuilding {
  /** Outer ring, [lon, lat], rounded to ~11cm. */
  r: [number, number][];
  /** Roof height in feet. */
  h: number;
  /** Building Identification Number, so the client can skip its own buildings. */
  b: string | null;
}

export interface ContextResult {
  buildings: ContextBuilding[];
  truncated: boolean;
  /** The bbox actually queried, after snapping. Lets the client cache by key. */
  bbox: [number, number, number, number];
}

/**
 * Snap to a coarse grid so panning a few metres reuses the previous response
 * instead of re-querying a 2MB dataset. 0.01° is roughly 1.1km — about half a
 * screen at the zoom where context first appears.
 */
const GRID = 0.01;

export function snapBbox(
  bbox: [number, number, number, number],
): [number, number, number, number] {
  const [w, s, e, n] = bbox;
  // Rounded to 3 decimals after snapping: `Math.floor(-73.9812 / 0.01) * 0.01`
  // is -73.99000000000001, and that trailing noise would make every cache key
  // — ours and the CDN's — subtly unique.
  const snap = (v: number, dir: (n: number) => number) =>
    Math.round(dir(v / GRID) * GRID * 1000) / 1000;
  return [snap(w, Math.floor), snap(s, Math.floor), snap(e, Math.ceil), snap(n, Math.ceil)];
}

/** A stable string for a snapped bbox, used as the client's cache key. */
export function bboxKey(bbox: [number, number, number, number]): string {
  return bbox.map((v) => v.toFixed(3)).join(',');
}

function headers(): Record<string, string> {
  const token = process.env.NYC_OPEN_DATA_APP_TOKEN;
  return token ? { 'X-App-Token': token } : {};
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Drops interior vertices that sit within `tol` degrees of the line between
 * their neighbours. Footprint rings carry survey-grade detail that is invisible
 * at city zoom, and the payload is dominated by it.
 */
function simplify(ring: [number, number][], tol: number): [number, number][] {
  if (ring.length <= 5) return ring;
  const out: [number, number][] = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    const [ax, ay] = out[out.length - 1];
    const [bx, by] = ring[i];
    const [cx, cy] = ring[i + 1];
    // Twice the triangle area over the base length — the perpendicular
    // distance from B to line AC.
    const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
    const base = Math.hypot(cx - ax, cy - ay);
    if (base === 0 || area / base > tol) out.push(ring[i]);
  }
  out.push(ring[ring.length - 1]);
  return out.length >= 4 ? out : ring;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Every outer ring in a Polygon or MultiPolygon geometry. */
function outerRings(geom: any): [number, number][][] {
  if (!geom) return [];
  const polys: any[] =
    geom.type === 'MultiPolygon'
      ? geom.coordinates
      : geom.type === 'Polygon'
        ? [geom.coordinates]
        : [];
  const rings: [number, number][][] = [];
  for (const poly of polys) {
    const ring = poly?.[0];
    if (Array.isArray(ring) && ring.length >= 4) {
      rings.push(ring.map((p: number[]) => [p[0], p[1]] as [number, number]));
    }
  }
  return rings;
}

export async function fetchCityContext(
  rawBbox: [number, number, number, number],
): Promise<ContextResult> {
  const bbox = snapBbox(rawBbox);
  const [w, s, e, n] = bbox;

  const polygon =
    `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
  // Tallest first. A dense bbox can exceed the cap, and when it does the
  // buildings that get dropped should be the one-storey sheds nobody would
  // notice — never a tower that defines the block.
  const url =
    `${FOOTPRINTS}?$select=the_geom,height_roof,bin` +
    `&$where=intersects(the_geom,'${polygon}')` +
    `&$order=height_roof DESC` +
    `&$limit=${CONTEXT_LIMIT}`;

  const res = await fetch(url, {
    headers: headers(),
    // The 2014 survey does not change. A day of caching turns a 2MB query into
    // one request per grid cell per day, shared across everyone in the office.
    next: { revalidate: 86400 },
  });

  if (!res.ok) {
    throw new Error(`NYC building footprints returned ${res.status}.`);
  }

  const records = (await res.json()) as any[];
  const buildings: ContextBuilding[] = [];

  for (const rec of records) {
    const height = num(rec.height_roof);
    const bin = typeof rec.bin === 'string' ? rec.bin : null;
    for (const ring of outerRings(rec.the_geom)) {
      buildings.push({
        r: simplify(ring, 0.000012).map(
          ([lon, lat]) => [round6(lon), round6(lat)] as [number, number],
        ),
        h: height && height > 0 ? height : FALLBACK_HEIGHT_FT,
        b: bin,
      });
    }
  }

  return { buildings, truncated: records.length >= CONTEXT_LIMIT, bbox };
}
