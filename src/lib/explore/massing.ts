/**
 * Footprint plus height → the vertex arrays a building is drawn from.
 *
 * Pure: no three.js, no WebGL, no DOM. It returns plain typed arrays that the
 * renderer wraps in a `BufferGeometry`, which is what lets the maths be unit
 * tested — and the maths is the part that decides whether a Goldenrod band
 * lands on the 14th floor or somewhere near it.
 *
 * Beyond position and normal, every wall vertex carries three attributes the
 * facade shader needs and cannot work out for itself:
 *
 * | Attribute | Meaning |
 * |---|---|
 * | `along` | Metres travelled around the building's perimeter. Keeps a window bay the same width on a 4 m return and a 60 m frontage |
 * | `up` | Metres above the building's own ground, so a floor line is at a floor height rather than at a fraction of the wall |
 * | `wall` | Height of the wall this vertex belongs to, in metres. Lets the shader fade detail out on a parapet without fading it out on a tower |
 *
 * `along` is deliberately *not* reset per edge. A window grid that restarts at
 * every vertex of a 22-point footprint reads as a seam at each corner, which
 * is the one artefact that says "procedural" out loud.
 */

import { openRing, toCCW } from './frame';
import { triangulate } from './tessellate';

export interface MassingArrays {
  position: Float32Array;
  normal: Float32Array;
  /** Metres around the perimeter. Zero on roof vertices. */
  along: Float32Array;
  /** Metres above the building's ground plane. */
  up: Float32Array;
  /** Height of the wall a vertex belongs to. Zero on roof vertices. */
  wall: Float32Array;
  /** 1 on wall vertices, 0 on roof vertices, so one material can serve both. */
  isWall: Float32Array;
  index: Uint32Array;
  triangles: number;
}

interface Builder {
  position: number[];
  normal: number[];
  along: number[];
  up: number[];
  wall: number[];
  isWall: number[];
  index: number[];
}

function newBuilder(): Builder {
  return { position: [], normal: [], along: [], up: [], wall: [], isWall: [], index: [] };
}

function finish(b: Builder): MassingArrays {
  return {
    position: new Float32Array(b.position),
    normal: new Float32Array(b.normal),
    along: new Float32Array(b.along),
    up: new Float32Array(b.up),
    wall: new Float32Array(b.wall),
    isWall: new Float32Array(b.isWall),
    index: new Uint32Array(b.index),
    triangles: b.index.length / 3,
  };
}

/**
 * One storey-band of wall around a ring, from `baseM` to `topM`.
 *
 * Each edge gets its own four vertices rather than sharing them with its
 * neighbours, because the normals differ: sharing them would smooth every
 * corner of the building into a rounded column, which is the single most
 * common way an extruded city ends up looking like melted wax.
 */
export function addWalls(
  b: Builder,
  ring: [number, number][],
  baseM: number,
  topM: number,
  alongStart = 0,
): number {
  const height = topM - baseM;
  let along = alongStart;

  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [cx, cy] = ring[(i + 1) % ring.length];
    const ex = cx - ax;
    const ey = cy - ay;
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;

    // Outward normal of a counter-clockwise ring is the edge direction turned
    // clockwise. Getting this backwards lights the inside of the building.
    const nx = ey / len;
    const ny = -ex / len;

    const base = b.position.length / 3;
    const corners: [number, number, number, number][] = [
      [ax, ay, baseM, along],
      [cx, cy, baseM, along + len],
      [cx, cy, topM, along + len],
      [ax, ay, topM, along],
    ];
    for (const [x, y, z, s] of corners) {
      b.position.push(x, y, z);
      b.normal.push(nx, ny, 0);
      b.along.push(s);
      b.up.push(z);
      b.wall.push(height);
      b.isWall.push(1);
    }
    b.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    along += len;
  }

  return along;
}

/** A flat cap over a ring at `z`, facing up. */
export function addRoof(b: Builder, ring: [number, number][], z: number): void {
  const tris = triangulate(ring);
  if (tris.length === 0) return;

  const base = b.position.length / 3;
  for (const [x, y] of ring) {
    b.position.push(x, y, z);
    b.normal.push(0, 0, 1);
    b.along.push(0);
    b.up.push(z);
    b.wall.push(0);
    b.isWall.push(0);
  }
  for (const t of tris) b.index.push(base + t);
}

/**
 * A plain extrusion: the fallback for a building the 2014 survey predates, and
 * the whole of the context city.
 *
 * `ring` is in scene metres and may wind either way — it is normalised here,
 * because a clockwise footprint extrudes with every wall normal pointing into
 * the building and the tower renders as an inside-out shell that is lit from
 * within and invisible from without.
 */
export function extrudedMassing(
  ring: [number, number][],
  heightM: number,
  baseM = 0,
): MassingArrays {
  const clean = toCCW(openRing(ring));
  const b = newBuilder();
  if (clean.length >= 3 && heightM > baseM) {
    addWalls(b, clean, baseM, heightM);
    addRoof(b, clean, heightM);
  }
  return finish(b);
}

/**
 * A stepped extrusion — a stack of prisms, each smaller than the one below.
 *
 * This is the *fallback* silhouette, used only where the city's surveyed model
 * has nothing: it is a guess in a way the LOD2 massing is not, so it is kept
 * deliberately mild and it is never applied to a building the survey covers.
 * The point is that a 1930s tower with no survey record should not end in the
 * same flat lid as a 2015 one, not that we know where its setbacks are.
 */
export interface Step {
  /** How far in from the footprint, as a fraction toward the centroid. */
  inset: number;
  /** Top of this step, in metres above the building's ground. */
  topM: number;
}

export function centroid(ring: [number, number][]): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
}

export function insetRingLocal(
  ring: [number, number][],
  factor: number,
): [number, number][] {
  const [cx, cy] = centroid(ring);
  return ring.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]);
}

export function steppedMassing(ring: [number, number][], steps: Step[]): MassingArrays {
  const clean = toCCW(openRing(ring));
  const b = newBuilder();
  if (clean.length < 3 || steps.length === 0) return finish(b);

  let baseM = 0;
  let along = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.topM <= baseM) continue;
    const stepRing = step.inset >= 0.999 ? clean : insetRingLocal(clean, step.inset);
    along = addWalls(b, stepRing, baseM, step.topM, along);

    /**
     * Every step gets a lid, not just the last one.
     *
     * The step above is narrower, so what is left exposed is a ring of
     * terrace — and that terrace IS the setback. Capping only the top left a
     * hole at every step through which you could see the inside of the
     * building's own back wall, which on screen read as a band of sky cutting
     * the tower in half. It looked like the geometry had come apart rather
     * than like a missing face, which is why it took a screenshot to find.
     *
     * The lid is drawn whole and the step above simply stands on it. Two
     * horizontal surfaces never z-fight with a vertical wall.
     */
    addRoof(b, stepRing, step.topM);
    baseM = step.topM;
  }

  return finish(b);
}

/**
 * The step profile for a building we have no surveyed massing for.
 *
 * Derived from year built and height alone, because those are the only two
 * things every building in the database actually has. Nothing is authored per
 * building, which is the rule this whole treatment lives under.
 *
 * | Era | Shape | Why |
 * |---|---|---|
 * | Before 1945 | Two setbacks, a taller shaft | The 1916 zoning resolution's sky-exposure planes are literally why Manhattan's pre-war towers are wedding cakes |
 * | 1945–1985 | One shallow step near the top | The tower-in-a-plaza era traded setbacks for a plaza and rose straight |
 * | After 1985 | A single slight crown | Modern towers step for architecture, not for law, and a guess here would be a lie about a specific building |
 *
 * Anything under 45 m does not step at all: a six-storey loft with a setback
 * in it is a building that does not exist.
 */
export function fallbackSteps(heightM: number, yearBuilt: number | null): Step[] {
  if (heightM < 45) return [{ inset: 1, topM: heightM }];

  const year = yearBuilt ?? 1965;
  /**
   * The insets are deliberately mild.
   *
   * The first version stepped a pre-war tower in to 68% of its footprint,
   * which is roughly true of the Empire State Building and produced a visible
   * bug everywhere else: a floor band is drawn on the GROUND footprint, so
   * every band above the first setback hung in mid-air a good ten metres out
   * from the wall it belonged to. Sprint 3 fixes that properly by taking the
   * band's ring from the massing's own cross-section — until then, and for the
   * buildings that never get surveyed massing, a shallow step says "this tower
   * has setbacks" without moving the wall out from under the availability.
   */
  if (year < 1945) {
    return [
      { inset: 1, topM: heightM * 0.45 },
      { inset: 0.94, topM: heightM * 0.72 },
      { inset: 0.86, topM: heightM },
    ];
  }
  if (year < 1985) {
    return [
      { inset: 1, topM: heightM * 0.9 },
      { inset: 0.96, topM: heightM },
    ];
  }
  return [
    { inset: 1, topM: heightM * 0.95 },
    { inset: 0.94, topM: heightM },
  ];
}

/** Concatenates several massings into one buffer, for instanced draw budget. */
export function mergeMassings(parts: MassingArrays[]): MassingArrays {
  const b = newBuilder();
  for (const p of parts) {
    const base = b.position.length / 3;
    for (let i = 0; i < p.position.length; i++) b.position.push(p.position[i]);
    for (let i = 0; i < p.normal.length; i++) b.normal.push(p.normal[i]);
    for (let i = 0; i < p.along.length; i++) b.along.push(p.along[i]);
    for (let i = 0; i < p.up.length; i++) b.up.push(p.up[i]);
    for (let i = 0; i < p.wall.length; i++) b.wall.push(p.wall[i]);
    for (let i = 0; i < p.isWall.length; i++) b.isWall.push(p.isWall[i]);
    for (let i = 0; i < p.index.length; i++) b.index.push(base + p.index[i]);
  }
  return finish(b);
}
