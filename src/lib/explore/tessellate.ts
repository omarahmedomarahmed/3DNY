/**
 * Ear clipping, for roofs and for the planar surfaces the city's LOD2 model
 * ships.
 *
 * Written here rather than pulled from three.js because it has to run in unit
 * tests with no WebGL and no DOM, and because sprint 3 needs to triangulate
 * arbitrary planar polygons in 3-D — a CityGML roof surface is a flat polygon
 * at some angle in space, not a 2-D outline. Projecting each one onto its own
 * best plane and clipping there is the whole trick, and it is short enough to
 * own.
 *
 * Simple polygons only: no holes, no self-intersection. Building footprints
 * and CityGML surfaces are both simple by construction. A polygon that defeats
 * the clipper returns the triangles it managed rather than throwing, because a
 * building rendering with a slightly wrong roof is a far better outcome in a
 * meeting than a scene that fails to build.
 */

/** Twice the signed area of a triangle. Positive for counter-clockwise. */
function cross(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function inTriangle(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): boolean {
  const d1 = cross(px, py, ax, ay, bx, by);
  const d2 = cross(px, py, bx, by, cx, cy);
  const d3 = cross(px, py, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * Triangulates a simple 2-D polygon, returning index triples into the input.
 *
 * The ring may wind either way; the output is always counter-clockwise in the
 * input's own coordinate system, which is what lets the caller decide a normal
 * once for the whole surface rather than per triangle.
 */
export function triangulate(ring: [number, number][]): number[] {
  const n = ring.length;
  if (n < 3) return [];

  // Work on indices so the result refers back to the caller's vertices.
  let indices = Array.from({ length: n }, (_, i) => i);

  // Area decides the winding. Clipping assumes counter-clockwise, so a
  // clockwise ring is walked backwards instead of being copied.
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % n];
    area2 += ax * by - bx * ay;
  }
  if (area2 < 0) indices.reverse();

  const out: number[] = [];
  // Every successful clip removes one vertex, so the loop cannot run more than
  // n times without making progress. The counter is the guard against a
  // degenerate ring spinning forever.
  let guard = n * n;

  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;

    for (let i = 0; i < indices.length; i++) {
      const ia = indices[(i + indices.length - 1) % indices.length];
      const ib = indices[i];
      const ic = indices[(i + 1) % indices.length];
      const [ax, ay] = ring[ia];
      const [bx, by] = ring[ib];
      const [cx, cy] = ring[ic];

      // Reflex vertices are not ears.
      if (cross(ax, ay, bx, by, cx, cy) <= 0) continue;

      // Nor is a vertex whose triangle swallows another vertex of the ring.
      let contains = false;
      for (const j of indices) {
        if (j === ia || j === ib || j === ic) continue;
        const [px, py] = ring[j];
        if (inTriangle(px, py, ax, ay, bx, by, cx, cy)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;

      out.push(ia, ib, ic);
      indices.splice(i, 1);
      clipped = true;
      break;
    }

    // No ear anywhere means the ring is degenerate or self-intersecting. Take
    // a fan from vertex zero and stop: wrong, but bounded and on screen.
    if (!clipped) break;
  }

  if (indices.length === 3) {
    out.push(indices[0], indices[1], indices[2]);
  } else if (indices.length > 3) {
    for (let i = 1; i < indices.length - 1; i++) {
      out.push(indices[0], indices[i], indices[i + 1]);
    }
  }

  return out;
}

/** A unit normal for a planar 3-D polygon, by Newell's method. */
export function polygonNormal(points: number[]): [number, number, number] {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = points.length / 3;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = points[i * 3], ay = points[i * 3 + 1], az = points[i * 3 + 2];
    const bx = points[j * 3], by = points[j * 3 + 1], bz = points[j * 3 + 2];
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  const len = Math.hypot(nx, ny, nz);
  // A degenerate surface — every vertex collinear — has no normal to give.
  // Up is the least surprising answer and the one that keeps it lit.
  if (len < 1e-12) return [0, 0, 1];
  return [nx / len, ny / len, nz / len];
}

/**
 * Triangulates a planar polygon in 3-D, flat-packed as [x,y,z, x,y,z, …].
 *
 * The polygon is dropped onto whichever axis plane it faces most squarely,
 * which is enough for a surface that is genuinely planar and avoids building
 * an orthonormal basis for every one of the eight thousand surfaces the city's
 * model ships.
 */
export function triangulatePlanar(points: number[]): number[] {
  const n = points.length / 3;
  if (n < 3) return [];

  const [nx, ny, nz] = polygonNormal(points);
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);

  const flat: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const x = points[i * 3];
    const y = points[i * 3 + 1];
    const z = points[i * 3 + 2];
    if (az >= ax && az >= ay) flat.push([x, y]);
    else if (ax >= ay) flat.push([y, z]);
    else flat.push([z, x]);
  }

  const tris = triangulate(flat);

  /**
   * Put the winding back on the surface's own normal.
   *
   * `triangulate` returns counter-clockwise in the plane it was handed, and
   * that plane is an axis projection whose orientation flips with the sign of
   * the dominant component — so a roof facing up and a ground surface facing
   * down come back wound identically. Left alone, half of every building's
   * surfaces face inward and vanish under backface culling. Which half depends
   * on the building, which is exactly the kind of bug that looks like missing
   * geometry rather than like a winding problem.
   */
  const dominant = az >= ax && az >= ay ? nz : ax >= ay ? nx : ny;
  if (dominant < 0) {
    for (let i = 0; i < tris.length; i += 3) {
      const t = tris[i + 1];
      tris[i + 1] = tris[i + 2];
      tris[i + 2] = t;
    }
  }

  return tris;
}
