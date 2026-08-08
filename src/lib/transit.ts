/**
 * Transit stops — subway, bus, ferry, commuter rail and PATH.
 *
 * Subway and bus come from the MTA's own published datasets. Ferry landings,
 * PATH and the rail terminals come from a short hand-kept table, because no
 * maintained open dataset covers them.
 *
 * Walk times are computed here rather than routed. See `walkMinutes`.
 */

export type TransitMode = 'subway' | 'bus' | 'ferry' | 'rail' | 'path' | 'tram';

export interface TransitStop {
  id: string;
  lon: number;
  lat: number;
  name: string;
  mode: TransitMode;
  /** Route designations serving the stop, e.g. ["4","5","6"] or ["M42"]. */
  routes: string[];
}

export interface TransitResult {
  stops: TransitStop[];
  bbox: [number, number, number, number];
}

/** Same grid as the city context, so the two caches line up. */
const GRID = 0.01;

export function snapTransitBbox(
  bbox: [number, number, number, number],
): [number, number, number, number] {
  const snap = (v: number, dir: (n: number) => number) =>
    Math.round(dir(v / GRID) * GRID * 1000) / 1000;
  const [w, s, e, n] = bbox;
  return [snap(w, Math.floor), snap(s, Math.floor), snap(e, Math.ceil), snap(n, Math.ceil)];
}

export function transitBboxKey(bbox: [number, number, number, number]): string {
  return bbox.map((v) => v.toFixed(3)).join(',');
}

// ---------------------------------------------------------------------------
// Distance and walking time
// ---------------------------------------------------------------------------

const EARTH_R = 6_371_000;

/** Great-circle metres between two lon/lat points. */
export function metersBetween(
  a: [number, number],
  b: [number, number],
): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/**
 * Nobody walks in a straight line through Manhattan — you walk two sides of a
 * block. 1.28 is the ratio a grid imposes on an average diagonal, and 1.35 m/s
 * is an unhurried pace in business shoes.
 *
 * This is an estimate, not a route. It ignores which corner the entrance is on
 * and every crossing signal, so it should be presented as "about" and never
 * quoted to the minute in a lease discussion.
 */
export const WALK_DETOUR = 1.28;
export const WALK_SPEED_MS = 1.35;

export function walkMinutes(straightLineMeters: number): number {
  return Math.max(1, Math.round((straightLineMeters * WALK_DETOUR) / WALK_SPEED_MS / 60));
}

/** Stops nearest a point, with distance and walking time attached. */
export interface NearbyStop extends TransitStop {
  meters: number;
  minutes: number;
}

export function nearestStops(
  origin: [number, number],
  stops: TransitStop[],
  opts: { limit?: number; maxMeters?: number; perMode?: number } = {},
): NearbyStop[] {
  const { limit = 8, maxMeters = 1200, perMode } = opts;

  const scored = stops
    .map((stop) => {
      const meters = metersBetween(origin, [stop.lon, stop.lat]);
      return { ...stop, meters, minutes: walkMinutes(meters) };
    })
    .filter((s) => s.meters <= maxMeters)
    .sort((a, b) => a.meters - b.meters);

  if (!perMode) return scored.slice(0, limit);

  // Keeping a per-mode quota stops eighty bus stops from burying the one
  // subway station that actually decides whether a tenant takes the space.
  const counts = new Map<TransitMode, number>();
  const out: NearbyStop[] = [];
  for (const stop of scored) {
    const seen = counts.get(stop.mode) ?? 0;
    if (seen >= perMode) continue;
    counts.set(stop.mode, seen + 1);
    out.push(stop);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * Official MTA data, via the state's open-data portal.
 *
 * The first version of this used OpenStreetMap through Overpass, which does
 * return every mode in one query — but Overpass is volunteer-run, rate-limits
 * by IP, and a deployment shares its IP with everyone else on the platform. It
 * returned 429 under nothing more than development traffic. These datasets are
 * first-party, carry the real route designations, and answer in well under a
 * second.
 */
const SUBWAY_URL = 'https://data.ny.gov/resource/39hk-dx4f.json';
const BUS_URL = 'https://data.ny.gov/resource/2ucp-7wg5.json';

/**
 * Ferry landings, PATH stations and the two rail terminals, by hand.
 *
 * There is no maintained open dataset for NYC Ferry landings, and PATH is a
 * Port Authority system that appears in neither MTA feed. There are fifteen of
 * them, they are among the most stable objects in the city, and a short table
 * that is always right beats a lookup that is sometimes missing. Coordinates
 * are the passenger entrance, not the centroid of the structure.
 */
const FIXED_STOPS: TransitStop[] = [
  // Rail terminals.
  { id: 'rail-penn', lon: -73.9935, lat: 40.7506, name: 'Penn Station', mode: 'rail', routes: ['LIRR', 'NJ Transit', 'Amtrak'] },
  { id: 'rail-gct', lon: -73.9772, lat: 40.7527, name: 'Grand Central Terminal', mode: 'rail', routes: ['Metro-North', 'LIRR'] },
  { id: 'rail-moynihan', lon: -73.9967, lat: 40.7522, name: 'Moynihan Train Hall', mode: 'rail', routes: ['LIRR', 'Amtrak'] },
  // PATH.
  { id: 'path-wtc', lon: -74.0099, lat: 40.7126, name: 'World Trade Center', mode: 'path', routes: ['PATH'] },
  { id: 'path-christopher', lon: -74.0067, lat: 40.7333, name: 'Christopher Street', mode: 'path', routes: ['PATH'] },
  { id: 'path-9th', lon: -74.0021, lat: 40.7376, name: '9th Street', mode: 'path', routes: ['PATH'] },
  { id: 'path-14th', lon: -74.0018, lat: 40.7376, name: '14th Street', mode: 'path', routes: ['PATH'] },
  { id: 'path-23rd', lon: -73.9930, lat: 40.7429, name: '23rd Street', mode: 'path', routes: ['PATH'] },
  { id: 'path-33rd', lon: -73.9884, lat: 40.7487, name: '33rd Street', mode: 'path', routes: ['PATH'] },
  // Ferry landings.
  { id: 'ferry-whitehall', lon: -74.0122, lat: 40.7010, name: 'Staten Island Ferry — Whitehall', mode: 'ferry', routes: ['Staten Island'] },
  { id: 'ferry-pier11', lon: -74.0043, lat: 40.7033, name: 'Pier 11 / Wall Street', mode: 'ferry', routes: ['NYC Ferry'] },
  { id: 'ferry-e34', lon: -73.9714, lat: 40.7428, name: 'East 34th Street', mode: 'ferry', routes: ['NYC Ferry'] },
  { id: 'ferry-w39', lon: -74.0028, lat: 40.7620, name: 'Midtown / West 39th Street', mode: 'ferry', routes: ['NY Waterway'] },
  { id: 'ferry-battery', lon: -74.0169, lat: 40.7053, name: 'Battery Park City / Vesey St', mode: 'ferry', routes: ['NY Waterway'] },
  { id: 'ferry-e90', lon: -73.9430, lat: 40.7817, name: 'East 90th Street', mode: 'ferry', routes: ['NYC Ferry'] },
];

function socrataHeaders(): Record<string, string> {
  const token = process.env.NYC_OPEN_DATA_APP_TOKEN;
  return token ? { 'X-App-Token': token } : {};
}

/** Socrata wants north,west,south,east — the opposite corners to a bbox. */
function withinBox(bbox: [number, number, number, number]): string {
  const [w, s, e, n] = bbox;
  return `within_box(georeference,${n},${w},${s},${e})`;
}

function inBbox(lon: number, lat: number, bbox: [number, number, number, number]): boolean {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

async function fetchSubway(bbox: [number, number, number, number]): Promise<TransitStop[]> {
  const url = `${SUBWAY_URL}?$where=${encodeURIComponent(withinBox(bbox))}&$limit=800`;
  const res = await fetch(url, { headers: socrataHeaders(), next: { revalidate: 604800 } });
  if (!res.ok) throw new Error(`Subway stations returned ${res.status}.`);
  const rows = (await res.json()) as any[];

  // One complex is several rows, one per line through it. Collapsing by name
  // and merging the route letters is what a broker means by "the station".
  const byName = new Map<string, TransitStop>();
  for (const row of rows) {
    const lon = Number(row.gtfs_longitude);
    const lat = Number(row.gtfs_latitude);
    const name = row.stop_name;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !name) continue;

    const routes = String(row.daytime_routes ?? '')
      .split(/\s+/)
      .filter(Boolean);
    const existing = byName.get(name);
    if (existing) {
      for (const r of routes) if (!existing.routes.includes(r)) existing.routes.push(r);
      continue;
    }
    byName.set(name, {
      id: `subway-${row.gtfs_stop_id ?? name}`,
      lon,
      lat,
      name,
      mode: 'subway',
      routes,
    });
  }
  for (const stop of byName.values()) stop.routes.sort();
  return [...byName.values()];
}

async function fetchBus(bbox: [number, number, number, number]): Promise<TransitStop[]> {
  // The dataset holds one row per route per stop per schedule bundle, and
  // keeps superseded bundles, so the in-effect filter is not optional.
  const where = `${withinBox(bbox)} AND in_effect='true'`;
  const url = `${BUS_URL}?$where=${encodeURIComponent(where)}&$limit=4000`;
  const res = await fetch(url, { headers: socrataHeaders(), next: { revalidate: 604800 } });
  if (!res.ok) throw new Error(`Bus stops returned ${res.status}.`);
  const rows = (await res.json()) as any[];

  const byStop = new Map<string, TransitStop>();
  for (const row of rows) {
    const lon = Number(row.longitude);
    const lat = Number(row.latitude);
    const id = row.stop_id;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !id) continue;

    const route = row.route_short_name ?? row.route_id ?? null;
    const existing = byStop.get(id);
    if (existing) {
      if (route && !existing.routes.includes(route)) existing.routes.push(route);
      continue;
    }
    byStop.set(id, {
      id: `bus-${id}`,
      lon,
      lat,
      // The feed shouts; a snapshot and a compare table should not.
      name: titleCase(row.stop_name ?? 'Bus stop'),
      mode: 'bus',
      routes: route ? [route] : [],
    });
  }
  for (const stop of byStop.values()) stop.routes.sort();
  return [...byStop.values()];
}

/** "1 AV/E 77 ST" reads as shouting in a table; "1 Av/E 77 St" does not. */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Av|St|Rd|Blvd|Pl|Sq|Ft)\b/g, (m) => m);
}

export async function fetchTransit(
  rawBbox: [number, number, number, number],
): Promise<TransitResult> {
  const bbox = snapTransitBbox(rawBbox);

  // Subway and bus are independent: one failing should not cost the other.
  const [subway, bus] = await Promise.allSettled([fetchSubway(bbox), fetchBus(bbox)]);

  const stops: TransitStop[] = [];
  if (subway.status === 'fulfilled') stops.push(...subway.value);
  if (bus.status === 'fulfilled') stops.push(...bus.value);

  if (subway.status === 'rejected' && bus.status === 'rejected') {
    throw new Error(
      subway.reason instanceof Error ? subway.reason.message : 'Transit data is unavailable.',
    );
  }

  stops.push(...FIXED_STOPS.filter((s) => inBbox(s.lon, s.lat, bbox)));
  return { stops, bbox };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export const MODE_LABEL: Record<TransitMode, string> = {
  subway: 'Subway',
  bus: 'Bus',
  ferry: 'Ferry',
  rail: 'Rail',
  path: 'PATH',
  tram: 'Tram',
};

/** Sort order for lists: the modes that decide a lease come first. */
export const MODE_RANK: Record<TransitMode, number> = {
  subway: 0,
  rail: 1,
  path: 2,
  ferry: 3,
  tram: 4,
  bus: 5,
};
