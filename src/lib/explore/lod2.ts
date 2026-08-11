import type { Massing, Surface } from '@/lib/citygml';
import { toCCW, toLocal, type LocalFrame } from './frame';
import { triangulatePlanar, polygonNormal } from './tessellate';
import type { MassingArrays } from './massing';

/**
 * NYC's surveyed massing, as geometry.
 *
 * §5 of the plan settles the argument for using this and gives the numbers.
 * What this file does is turn one building's classified CityGML surfaces into
 * the same vertex arrays an extrusion produces, so the renderer does not know
 * or care which of the two it is drawing.
 *
 * The coordinate story, because it is where this goes wrong quietly:
 *
 * | | |
 * |---|---|
 * | `citygml.ts` output | metres, recentred on the building's own bounding box, z from its ground surface |
 * | Axes | x east, y north, z up — state plane's own, which is what the scene uses |
 * | Grid convergence | under 0.02° anywhere in Manhattan, so about 1.5 cm across a 100 m building. Ignored deliberately, not overlooked |
 * | Anchor | `massing.anchor` is [lon, lat] of that bounding box's centre |
 *
 * Ground surfaces are dropped. They sit at the building's own datum, under
 * everything, and drawing them costs triangles to render a face nobody can
 * ever see.
 *
 * **Masts are not floors.** The model's top includes spires and antennas — the
 * Empire State Building measures 443.7 m to its mast against a 377.6 m roof —
 * so nothing here is ever used to derive a floor elevation. Floor positions
 * keep coming from `height_roof_ft` and `num_floors`, exactly as the plan
 * requires. This gives silhouette and nothing else.
 */

export interface Lod2Asset {
  version: number;
  source: string;
  sourceUrl: string;
  surveyYear: number;
  buildings: Record<string, Massing>;
  missing: { bin: string; address: string }[];
}

/** The `along` a facade shader needs, for a wall at an arbitrary angle. */
function wallTangent(normal: [number, number, number]): [number, number] {
  const len = Math.hypot(normal[0], normal[1]);
  // A horizontal surface has no tangent worth having; it will be classed as
  // roof anyway and never reads `along`.
  if (len < 1e-6) return [1, 0];
  return [-normal[1] / len, normal[0] / len];
}

/**
 * One surveyed building, in the scene's frame.
 *
 * `along` is measured from the building's own anchor rather than from each
 * surface's first vertex, so two coplanar wall polygons — which the model
 * ships in abundance, one per storey band on some towers — share a window
 * grid instead of each restarting it. Where two walls genuinely meet at a
 * corner the grid does break, and that is correct: a real building has a
 * corner there.
 */
export function massingToArrays(
  frame: LocalFrame,
  massing: Massing,
  options: { includeRoofs?: boolean } = {},
): MassingArrays {
  const [ox, oy] = toLocal(frame, massing.anchor[0], massing.anchor[1]);
  const includeRoofs = options.includeRoofs ?? true;

  const position: number[] = [];
  const normal: number[] = [];
  const along: number[] = [];
  const up: number[] = [];
  const wall: number[] = [];
  const isWall: number[] = [];
  const index: number[] = [];

  for (const surface of massing.surfaces) {
    if (surface.k === 'G') continue;
    if (surface.k === 'R' && !includeRoofs) continue;
    if (surface.p.length < 9) continue;

    const tris = triangulatePlanar(surface.p);
    if (tris.length === 0) continue;

    const n = polygonNormal(surface.p);
    const [tx, ty] = wallTangent(n);
    const isWallSurface = surface.k === 'W' ? 1 : 0;

    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 2; i < surface.p.length; i += 3) {
      if (surface.p[i] < minZ) minZ = surface.p[i];
      if (surface.p[i] > maxZ) maxZ = surface.p[i];
    }
    const height = maxZ - minZ;

    const base = position.length / 3;
    for (let i = 0; i < surface.p.length; i += 3) {
      const x = surface.p[i] + ox;
      const y = surface.p[i + 1] + oy;
      const z = surface.p[i + 2];
      position.push(x, y, z);
      normal.push(n[0], n[1], n[2]);
      // Relative to the building's anchor, so coplanar neighbours agree.
      along.push((x - ox) * tx + (y - oy) * ty);
      up.push(z);
      wall.push(height);
      isWall.push(isWallSurface);
    }
    for (const t of tris) index.push(base + t);
  }

  return {
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    along: new Float32Array(along),
    up: new Float32Array(up),
    wall: new Float32Array(wall),
    isWall: new Float32Array(isWall),
    index: new Uint32Array(index),
    triangles: index.length / 3,
  };
}

/**
 * How wide the surveyed building is, at a series of heights.
 *
 * This is what makes the surveyed massing pay for itself twice. The first
 * payment is silhouette; the second, and the one §5 argues is the real
 * reason, is that a Goldenrod band can now be drawn on the tower rather than
 * on the base it rises out of.
 *
 * The profile is a scalar per height — the building's horizontal reach at that
 * elevation as a fraction of its reach at the ground — because that is exactly
 * the shape `insetRing` consumes, and it keeps the band the footprint's own
 * outline rather than replacing it with a circle. A true cross-section would
 * be a mesh slice and a loop stitch; measured against what a broker can see on
 * a collar three centimetres proud of a wall, it would buy nothing.
 *
 * The 90th percentile rather than the maximum: the model's towers carry
 * flagpoles, mast bases and parapet returns that reach further out than the
 * wall does, and a single such vertex would widen the whole storey.
 */
export interface HeightProfile {
  /** Metres above the building's ground, ascending. */
  heights: number[];
  /**
   * Horizontal reach at that height, in METRES from the building's anchor.
   *
   * Absolute rather than a fraction of the reach at ground, and the difference
   * is not academic. A fraction has to be applied to something, and the only
   * thing available is the footprint from NYC's building-footprint dataset —
   * whose extent is not the same as the surveyed model's extent at ground
   * level. Scaling by a ratio between two different measurements put the
   * Empire State Building's bands about twenty percent inside its own shaft,
   * which reads as bands that have gone missing. Metres divided by metres,
   * measured the same way on both sides, is the only form of this that is
   * right.
   */
  radii: number[];
  /** The surveyed top, mast included. Never used for floor positions. */
  topM: number;
}

const PROFILE_SAMPLES = 64;

export function heightProfile(massing: Massing): HeightProfile | null {
  /**
   * A wall is measured over its whole span, not at its vertices.
   *
   * The first version bucketed wall VERTICES by height and let a band with no
   * vertices inherit the one below it. That is wrong in exactly the case that
   * matters: a tower's shaft is one tall quad whose only vertices are at its
   * foot and its crown, so every band in between inherited — and the chain
   * started at the base block, which on the Empire State Building is twice the
   * width of the shaft. The result was a profile that said "as wide as the lot,
   * all the way up", and a Goldenrod band on floor 32 hanging thirty metres out
   * in the air. That is the precise failure §5 exists to fix, reintroduced by
   * a sampling bug.
   *
   * So each wall contributes its reach to every height it SPANS.
   */
  const walls: { zMin: number; zMax: number; radii: number[] }[] = [];
  let topM = 0;

  for (const s of massing.surfaces) {
    if (s.k !== 'W' || s.p.length < 9) continue;
    let zMin = Infinity;
    let zMax = -Infinity;
    const radii: number[] = [];
    for (let i = 0; i < s.p.length; i += 3) {
      const z = s.p[i + 2];
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
      radii.push(Math.hypot(s.p[i], s.p[i + 1]));
    }
    if (radii.length === 0) continue;
    if (zMax > topM) topM = zMax;
    walls.push({ zMin, zMax, radii });
  }

  if (walls.length === 0 || topM <= 0) return null;

  const heights: number[] = [];
  const radii: number[] = [];
  const band = topM / PROFILE_SAMPLES;

  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const z = (i + 0.5) * band;
    const reach: number[] = [];
    for (const w of walls) {
      // A hair of tolerance, so a wall that ends exactly on a sample boundary
      // still counts for the band it caps.
      if (z >= w.zMin - 0.01 && z <= w.zMax + 0.01) reach.push(...w.radii);
    }
    heights.push(i * band);
    if (reach.length === 0) {
      radii.push(radii.length > 0 ? radii[radii.length - 1] : 0);
      continue;
    }
    reach.sort((a, b) => a - b);
    /**
     * The 90th percentile, not the maximum.
     *
     * The model's towers carry flagpole bases, parapet returns and mast
     * housings that reach further out than the wall does. One such vertex
     * would widen a whole storey and put the band back out in the air.
     */
    radii.push(reach[Math.min(reach.length - 1, Math.floor(reach.length * 0.9))]);
  }

  if (!radii.some((r) => r > 0)) return null;
  return { heights, radii, topM };
}

/**
 * The same 90th-percentile reach, for a footprint ring in lon/lat.
 *
 * Both sides of the inset ratio have to be measured the same way or the ratio
 * means nothing. This is that measurement for the ring the band is actually
 * drawn from.
 */
export function ringReachM(ring: [number, number][]): number {
  if (ring.length === 0) return 0;
  let cx = 0;
  let cy = 0;
  for (const [lon, lat] of ring) {
    cx += lon;
    cy += lat;
  }
  cx /= ring.length;
  cy /= ring.length;

  const mPerLon = 111_320 * Math.cos((cy * Math.PI) / 180);
  const radii = ring
    .map(([lon, lat]) => Math.hypot((lon - cx) * mPerLon, (lat - cy) * 110_574))
    .sort((a, b) => a - b);
  return radii[Math.min(radii.length - 1, Math.floor(radii.length * 0.9))];
}

/** The surveyed reach at a height, in metres, interpolated between samples. */
export function radiusFromProfile(profile: HeightProfile, zM: number): number {
  const { heights, radii } = profile;
  if (heights.length === 0) return 0;
  if (zM <= heights[0]) return radii[0];
  for (let i = 1; i < heights.length; i++) {
    if (zM <= heights[i]) {
      const t = (zM - heights[i - 1]) / Math.max(1e-6, heights[i] - heights[i - 1]);
      return radii[i - 1] + (radii[i] - radii[i - 1]) * t;
    }
  }
  return radii[radii.length - 1];
}

/**
 * The building's actual outline at a height — a slice through the massing.
 *
 * This replaces the scalar-inset approximation, and it had to. A single
 * shrink factor applied about the footprint's centroid cannot describe a shaft
 * that is off-centre in its plot or that has a different aspect ratio from the
 * plot — and the Empire State Building is both. Scaling its 130 × 60 m
 * footprint by one number put the band outside the tower on the short axis and
 * inside it on the long one at the same time, which on screen looked like the
 * band had gone missing.
 *
 * The slice is exact: a wall in this model is a vertical polygon, so an edge
 * that crosses the plane crosses it at that edge's own horizontal position.
 *
 * The hull is not exact, and deliberately. Stitching the segments into an
 * ordered loop needs adjacency the model does not publish, and the failure
 * mode of getting it wrong is a self-intersecting ring — which renders as a
 * bow tie across the building. A convex hull is always a simple polygon,
 * always the right size, always in the right place, and for a collar that
 * wraps the OUTSIDE of a building it is arguably the shape you want anyway.
 * What it costs is a courtyard: a doughnut-plan building gets a band across
 * its light well. That is a real limitation and it is worth the exchange.
 */
export function sectionAt(massing: Massing, zM: number): [number, number][] {
  /**
   * Each wall contributes a SEGMENT, not two loose points.
   *
   * That is the whole difference between this and the convex hull it
   * replaces. A wall in this model is a vertical polygon, so a plane through
   * it cuts a single horizontal segment between its two vertical edges — and
   * a segment carries the one piece of information a point does not: which
   * other point it is joined to. With that, the slice can be chained into the
   * building's real outline; without it, the best available answer is the
   * hull, which fills in every concavity.
   */
  const segments: [number, number, number, number][] = [];

  for (const s of massing.surfaces) {
    if (s.k !== 'W' || s.p.length < 9) continue;
    const n = s.p.length / 3;
    const crossings: [number, number][] = [];

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const az = s.p[i * 3 + 2];
      const bz = s.p[j * 3 + 2];
      // Only edges that straddle the plane. `>=`/`<=` on both sides would
      // double-count a vertex sitting exactly on it.
      if ((az < zM && bz < zM) || (az > zM && bz > zM)) continue;
      if (Math.abs(bz - az) < 1e-9) {
        // A horizontal edge lying in the plane: both ends are on the cut.
        crossings.push([s.p[i * 3], s.p[i * 3 + 1]]);
        crossings.push([s.p[j * 3], s.p[j * 3 + 1]]);
        continue;
      }
      const t = (zM - az) / (bz - az);
      if (t < -0.001 || t > 1.001) continue;
      crossings.push([
        s.p[i * 3] + (s.p[j * 3] - s.p[i * 3]) * t,
        s.p[i * 3 + 1] + (s.p[j * 3 + 1] - s.p[i * 3 + 1]) * t,
      ]);
    }

    // A convex wall gives two crossings. More than two happens on a folded
    // surface; pairing them in order is right for those and harmless
    // otherwise, because they arrive in the polygon's own winding order.
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const [ax, ay] = crossings[i];
      const [bx, by] = crossings[i + 1];
      if (Math.hypot(bx - ax, by - ay) < 1e-4) continue;
      segments.push([ax, ay, bx, by]);
    }
  }

  if (segments.length === 0) return [];

  const stitched = stitchLoop(segments);
  if (stitched.length >= 3) return toCCW(stitched);

  /**
   * The hull, when stitching cannot find a loop.
   *
   * A building whose walls do not close at this height — a model with a gap
   * in it, or a slice exactly through a setback where two shells meet — has
   * no outline to chain. A hull is always a simple polygon of about the right
   * size in about the right place, which is a far better failure than a
   * self-intersecting ring drawn as a bow tie across the building.
   */
  const points: [number, number][] = [];
  for (const [ax, ay, bx, by] of segments) {
    points.push([ax, ay], [bx, by]);
  }
  return convexHull(points);
}

/**
 * Chains cut segments into the longest closed loop they form.
 *
 * Endpoints are matched on a decimetre grid, which is exactly the precision
 * `citygml.ts` rounds its coordinates to — so two segments that genuinely
 * share a corner share it to the bit, and two that merely pass near each other
 * do not.
 *
 * The LONGEST loop, because a building can slice into several: a tower with a
 * detached annexe, or a lightwell, gives an outer ring and an inner one. The
 * outer is the one a collar wraps and the one a floor plate stands on.
 */
export function stitchLoop(
  segments: [number, number, number, number][],
): [number, number][] {
  const key = (x: number, y: number) => `${Math.round(x * 10)},${Math.round(y * 10)}`;

  /** Every segment that touches a given node. */
  const at = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i++) {
    for (const k of [key(segments[i][0], segments[i][1]), key(segments[i][2], segments[i][3])]) {
      const list = at.get(k);
      if (list) list.push(i);
      else at.set(k, [i]);
    }
  }

  const used = new Array<boolean>(segments.length).fill(false);
  let best: [number, number][] = [];

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;

    const loop: [number, number][] = [];
    let current = start;
    let [cx, cy] = [segments[start][0], segments[start][1]];
    const startKey = key(cx, cy);
    // A guard rather than a condition: a malformed set of segments could
    // otherwise walk in a circle that never returns to its start.
    let guard = segments.length + 2;

    while (guard-- > 0) {
      used[current] = true;
      loop.push([cx, cy]);

      const [ax, ay, bx, by] = segments[current];
      // Step to whichever end of this segment we did NOT arrive at.
      const [nx, ny] = key(ax, ay) === key(cx, cy) ? [bx, by] : [ax, ay];
      if (key(nx, ny) === startKey) {
        // Closed. A loop of two segments is a degenerate back-and-forth.
        if (loop.length >= 3 && loop.length > best.length) best = loop;
        break;
      }

      const next = (at.get(key(nx, ny)) ?? []).find((i) => !used[i]);
      if (next === undefined) break;
      current = next;
      cx = nx;
      cy = ny;
    }
  }

  return best;
}

/** Andrew's monotone chain. Counter-clockwise, no repeated closing vertex. */
export function convexHull(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? hull : points;
}
