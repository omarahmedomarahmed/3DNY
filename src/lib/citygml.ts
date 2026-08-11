/**
 * Reading NYC's 3-D Building Model.
 *
 * The city publishes a CityGML massing model of every building standing in
 * 2014 — roof, wall and ground surfaces, classified, with real setbacks. It is
 * the only public source for what a Manhattan tower actually looks like above
 * the fifth floor, and the difference between a goldenrod band that wraps the
 * Empire State Building's tower and one that wraps its base.
 *
 * Everything here is pure: parsing, projection and tile selection. The network
 * and filesystem live in `scripts/fetch-lod2-massing.ts`.
 *
 * Source: https://www.nyc.gov/content/oti — "3-D Building Model", one-time
 * capture from the 2014 aerial survey. Never reflown, so anything built since
 * is absent; callers must fall back to the extruded footprint for those.
 */

/** A classified surface. R = roof, W = wall, G = ground. */
export type SurfaceKind = 'R' | 'W' | 'G';

export interface Surface {
  k: SurfaceKind;
  /** Flat [x, y, z, x, y, z, …] in metres, local to the building's anchor. */
  p: number[];
}

export interface Massing {
  /** [lon, lat] of the model's bounding-box centre, WGS84. */
  anchor: [number, number];
  /** Highest point in metres above the ground surface — mast included. */
  topM: number;
  surfaces: Surface[];
}

/** A delivery area: one tile of the citywide model. */
export interface Tile {
  /** e.g. `DA12`. */
  name: string;
  /** Path inside the published zip. */
  entry: string;
  /** [minX, minY, maxX, maxY] in EPSG:2263 US survey feet. */
  bbox: [number, number, number, number];
}

// ---------------------------------------------------------------------------
// EPSG:2263 — NAD83 / New York Long Island, US survey feet.
// Lambert Conformal Conic 2SP on GRS80. Written out rather than pulled from
// proj4 because it is forty lines and this is the only projection we need.
// ---------------------------------------------------------------------------

const A = 6378137.0;
const F = 1 / 298.257222101;
const E = Math.sqrt(2 * F - F * F);
const RAD = Math.PI / 180;

const LAT_1 = (40 + 40 / 60) * RAD;
const LAT_2 = (41 + 2 / 60) * RAD;
const LAT_0 = (40 + 10 / 60) * RAD;
const LON_0 = -74 * RAD;
const FALSE_EASTING_FT = 984250.0;

/** The US survey foot — 1200/3937 m exactly. Not the international foot. */
export const US_SURVEY_FOOT = 1200 / 3937;

function lccM(lat: number) {
  return Math.cos(lat) / Math.sqrt(1 - E * E * Math.sin(lat) ** 2);
}

function lccT(lat: number) {
  const s = E * Math.sin(lat);
  return Math.tan(Math.PI / 4 - lat / 2) / (((1 - s) / (1 + s)) ** (E / 2));
}

const N = (Math.log(lccM(LAT_1)) - Math.log(lccM(LAT_2))) /
  (Math.log(lccT(LAT_1)) - Math.log(lccT(LAT_2)));
const BIG_F = lccM(LAT_1) / (N * lccT(LAT_1) ** N);
const R_0 = A * BIG_F * lccT(LAT_0) ** N;

/** WGS84 degrees → EPSG:2263 US survey feet. */
export function wgs84ToStatePlane(lon: number, lat: number): [number, number] {
  const r = A * BIG_F * lccT(lat * RAD) ** N;
  const theta = N * (lon * RAD - LON_0);
  const east = FALSE_EASTING_FT + (r * Math.sin(theta)) / US_SURVEY_FOOT;
  const north = (R_0 - r * Math.cos(theta)) / US_SURVEY_FOOT;
  return [east, north];
}

/** EPSG:2263 US survey feet → WGS84 degrees. */
export function statePlaneToWgs84(east: number, north: number): [number, number] {
  const x = (east - FALSE_EASTING_FT) * US_SURVEY_FOOT;
  const y = R_0 - north * US_SURVEY_FOOT;
  const r = Math.sign(N) * Math.hypot(x, y);
  const theta = Math.atan2(x, y);
  const t = (r / (A * BIG_F)) ** (1 / N);

  // Snyder 15-11: iterate to invert the isometric latitude.
  let lat = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 12; i++) {
    const s = E * Math.sin(lat);
    const next = Math.PI / 2 - 2 * Math.atan(t * (((1 - s) / (1 + s)) ** (E / 2)));
    if (Math.abs(next - lat) < 1e-13) { lat = next; break; }
    lat = next;
  }
  return [(theta / N + LON_0) / RAD, lat / RAD];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const BIN_RE = /name="BIN">\s*<gen:value>(\d+)<\/gen:value>/;
const POSLIST_RE = /<gml:posList>([^<]*)<\/gml:posList>/g;
const SURFACE_RE = /<bldg:(Roof|Wall|Ground)Surface\b([\s\S]*?)<\/bldg:\1Surface>/g;
const ENVELOPE_RE =
  /<gml:lowerCorner>([^<]*)<\/gml:lowerCorner>\s*<gml:upperCorner>([^<]*)<\/gml:upperCorner>/;

/** The BIN a `<bldg:Building>` block is keyed to, or null if it carries none. */
export function binOf(member: string): string | null {
  return BIN_RE.exec(member)?.[1] ?? null;
}

/** Every classified surface in one `<bldg:Building>` block, in feet, unmoved. */
export function surfacesOf(member: string): { k: SurfaceKind; pts: number[][] }[] {
  const out: { k: SurfaceKind; pts: number[][] }[] = [];
  SURFACE_RE.lastIndex = 0;
  let surface: RegExpExecArray | null;
  while ((surface = SURFACE_RE.exec(member)) !== null) {
    const k = surface[1][0] as SurfaceKind;
    POSLIST_RE.lastIndex = 0;
    let list: RegExpExecArray | null;
    while ((list = POSLIST_RE.exec(surface[2])) !== null) {
      const v = list[1].trim().split(/\s+/).map(Number);
      const pts: number[][] = [];
      for (let i = 0; i + 2 < v.length; i += 3) pts.push([v[i], v[i + 1], v[i + 2]]);
      if (pts.length >= 3) out.push({ k, pts });
    }
  }
  return out;
}

/**
 * Recentre a building on its own bounding box and convert feet to metres, so
 * every building ships as small local numbers rather than seven-digit state
 * plane coordinates. z is measured from the ground surface, not the datum.
 */
export function toMassing(surfaces: { k: SurfaceKind; pts: number[][] }[]): Massing | null {
  if (surfaces.length === 0) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of surfaces) {
    for (const p of s.pts) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Ground surfaces carry the datum elevation the building sits on. A few
  // buildings have none, so fall back to the lowest point of any surface.
  const ground = surfaces.filter((s) => s.k === 'G').flatMap((s) => s.pts.map((p) => p[2]));
  const z0 = ground.length > 0
    ? Math.min(...ground)
    : Math.min(...surfaces.flatMap((s) => s.pts.map((p) => p[2])));

  const round = (n: number) => Math.round(n * 10) / 10;
  const out: Surface[] = surfaces.map((s) => ({
    k: s.k,
    p: s.pts.flatMap((p) => [
      round((p[0] - cx) * US_SURVEY_FOOT),
      round((p[1] - cy) * US_SURVEY_FOOT),
      round((p[2] - z0) * US_SURVEY_FOOT),
    ]),
  }));

  let topM = 0;
  for (const s of out) for (let i = 2; i < s.p.length; i += 3) if (s.p[i] > topM) topM = s.p[i];

  return { anchor: statePlaneToWgs84(cx, cy), topM: round(topM), surfaces: out };
}

/**
 * The `<gml:Envelope>` a tile opens with, as [minX, minY, maxX, maxY] in feet.
 *
 * Two of the twenty tiles ship `NaN` as the elevation of a corner, so only the
 * horizontal pair is validated — that is all tile selection ever uses, and
 * rejecting the envelope over a bad z would silently drop a whole tile.
 */
export function envelopeOf(head: string): [number, number, number, number] | null {
  const m = ENVELOPE_RE.exec(head);
  if (!m) return null;
  const lo = m[1].trim().split(/\s+/).map(Number);
  const hi = m[2].trim().split(/\s+/).map(Number);
  const box = [lo[0], lo[1], hi[0], hi[1]];
  if (box.some((n) => n === undefined || Number.isNaN(n))) return null;
  return box as [number, number, number, number];
}

/**
 * The tiles worth downloading for a set of buildings. Delivery areas overlap,
 * so a building can fall in more than one; we want every tile that could hold
 * one of ours, and none of the other seventeen.
 */
export function pickTiles(tiles: Tile[], points: [number, number][]): Tile[] {
  const feet = points.map(([lon, lat]) => wgs84ToStatePlane(lon, lat));
  return tiles.filter((t) =>
    feet.some(([x, y]) => x >= t.bbox[0] && x <= t.bbox[2] && y >= t.bbox[1] && y <= t.bbox[3]),
  );
}

/**
 * Split an inflating CityGML stream into `<bldg:Building>` blocks. Returns the
 * blocks found and whatever tail did not terminate, to be prepended next call —
 * the tiles run to 1.4 GB uncompressed, so nothing here may hold the whole file.
 *
 * The prefix is optional on purpose: the city's tiles are not consistent about
 * it. Most write `<core:cityObjectMember>`, but DA2 and DA4 write it bare, and
 * matching only the prefixed form against those would buffer the entire tile
 * into one string and quietly find nothing.
 */
const MEMBER_END = /<\/(?:\w+:)?cityObjectMember>/;

export function splitMembers(buffer: string): { members: string[]; rest: string } {
  const parts = buffer.split(MEMBER_END);
  const rest = parts.pop() ?? '';
  return { members: parts.filter((p) => p.includes('<bldg:Building')), rest };
}
