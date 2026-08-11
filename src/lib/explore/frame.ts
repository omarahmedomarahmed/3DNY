/**
 * The local metric frame Explore mode's geometry lives in.
 *
 * MapLibre hands a custom layer a projection matrix in Mercator units, where
 * one unit is the whole world and altitude is scaled by latitude. Building
 * geometry in those units is unworkable: a window mullion is about 4e-9 of a
 * unit, which is past the resolution of a 32-bit float, and every shader that
 * wants a distance in metres has to undo the projection first.
 *
 * So the scene is metres, right-handed, with an origin somewhere near the
 * buildings:
 *
 *     +X east    +Y north    +Z up
 *
 * and the layer multiplies MapLibre's matrix by a single translate-and-scale
 * that puts that frame where it belongs. Everything else — massing, facades,
 * collision, agent paths — is written in plain metres and never sees Mercator.
 *
 * The projection here is a local tangent plane, not Mercator. Over the couple
 * of kilometres Explore mode is ever looking at, the difference from a proper
 * geodesic is centimetres, and the plane has the property that matters: a
 * metre is a metre in both axes, so a square building is square.
 */

/** Metres per degree of latitude. Constant enough at this scale. */
const M_PER_DEG_LAT = 110_574;
/** Metres per degree of longitude at the equator, before the cosine. */
const M_PER_DEG_LON = 111_320;

export interface LocalFrame {
  /** Longitude of the scene origin. */
  lon0: number;
  /** Latitude of the scene origin. */
  lat0: number;
  /** Metres per degree of longitude at this latitude. */
  mPerLon: number;
}

export function makeFrame(lon0: number, lat0: number): LocalFrame {
  return {
    lon0,
    lat0,
    mPerLon: M_PER_DEG_LON * Math.cos((lat0 * Math.PI) / 180),
  };
}

/** WGS84 → scene metres, east and north of the frame origin. */
export function toLocal(frame: LocalFrame, lon: number, lat: number): [number, number] {
  return [(lon - frame.lon0) * frame.mPerLon, (lat - frame.lat0) * M_PER_DEG_LAT];
}

/** Scene metres → WGS84. The exact inverse of `toLocal`. */
export function toLngLat(frame: LocalFrame, x: number, y: number): [number, number] {
  return [frame.lon0 + x / frame.mPerLon, frame.lat0 + y / M_PER_DEG_LAT];
}

/** A whole ring, projected. */
export function ringToLocal(
  frame: LocalFrame,
  ring: [number, number][],
): [number, number][] {
  return ring.map(([lon, lat]) => toLocal(frame, lon, lat));
}

/**
 * Drops a duplicated closing vertex, which GeoJSON rings always carry and
 * every triangulator and edge walk here would otherwise treat as a zero-length
 * edge.
 */
export function openRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  return Math.abs(fx - lx) < 1e-12 && Math.abs(fy - ly) < 1e-12 ? ring.slice(0, -1) : ring;
}

/** Twice the signed area. Positive when the ring winds counter-clockwise. */
export function signedArea2(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    sum += ax * by - bx * ay;
  }
  return sum;
}

/** The same ring wound counter-clockwise, whichever way it arrived. */
export function toCCW(ring: [number, number][]): [number, number][] {
  return signedArea2(ring) < 0 ? [...ring].reverse() : ring;
}

/** Axis-aligned bounds of a ring, as [minX, minY, maxX, maxY]. */
export function ringBounds(ring: [number, number][]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** Whether a point is inside a ring. Ray casting; boundary is unspecified. */
export function pointInRing(ring: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Shortest distance from a point to a ring's boundary, and the direction to
 * push the point away from the nearest edge.
 *
 * This is the whole of Explore mode's collision test. A walking camera is a
 * capsule and a building is a prism, so "am I inside the footprint, and which
 * way is out" answers it completely — which is why the plan says not to add a
 * physics engine.
 */
export function nearestEdge(
  ring: [number, number][],
  x: number,
  y: number,
): { distance: number; nx: number; ny: number } {
  let best = Infinity;
  let bx = 1;
  let by = 0;

  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [cx, cy] = ring[(i + 1) % ring.length];
    const ex = cx - ax;
    const ey = cy - ay;
    const len2 = ex * ex + ey * ey;
    // A degenerate edge has no direction to offer; the next one will.
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / len2)) : 0;
    const px = ax + ex * t;
    const py = ay + ey * t;
    const dx = x - px;
    const dy = y - py;
    const d = Math.hypot(dx, dy);
    if (d < best) {
      best = d;
      if (d > 1e-9) {
        bx = dx / d;
        by = dy / d;
      } else {
        // Exactly on the edge: the outward normal of that edge is the only
        // direction with any meaning left.
        const el = Math.hypot(ex, ey) || 1;
        bx = ey / el;
        by = -ex / el;
      }
    }
  }

  return { distance: best, nx: bx, ny: by };
}
