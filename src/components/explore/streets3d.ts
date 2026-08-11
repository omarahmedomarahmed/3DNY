import * as THREE from 'three';
import type { RoadSegment, StreetscapeResult } from '@/lib/streetscape';
import type { AtmospherePreset } from '../map/atmosphere';
import { ringToLocal, type LocalFrame } from '@/lib/explore/frame';
import { groundColor } from './ground3d';

/**
 * The roadbed, as geometry.
 *
 * The flat map draws its streets with deck.gl, and Explore mode cannot: an
 * opaque road on deck.gl's own canvas paints over the tower standing beside
 * it. Until this existed the walk put you on a featureless grey plane with
 * cars sliding across it, which is worse than no cars — a car needs a road
 * under it or it reads as a bug.
 *
 * Ribbons rather than a texture: each centreline is widened to its own
 * published roadbed width, which is real data (CSCL's kerb-to-kerb figure) and
 * is what makes Sixth Avenue wider than a side street without anyone deciding
 * that it should be.
 *
 * The heights are a real section now, not a stack of decals. The first version
 * laid the pavement *under* the roadbed as one full-width ribbon two
 * centimetres down, which is fine seen from a drone and wrong the moment the
 * eye is at 1.68 m: there was no kerb, so the street had no edge, and a street
 * with no edge is a car park.
 *
 * | Surface | z |
 * |---|---|
 * | Ground plane | −0.05 m |
 * | Roadbed | +0.02 m |
 * | Lane markings | +0.03 m |
 * | Kerb face | +0.02 → +0.16 m |
 * | Pavement | +0.16 m |
 *
 * The pavement is two ribbons offset either side of the centreline rather than
 * one wide one, which is what allows it to be *above* the roadbed instead of
 * below it.
 */

/** Metres of pavement either side of the roadbed. */
const PAVEMENT_M = 3.2;

const ROAD_Z = 0.02;
const MARKING_Z = 0.03;
/** A New York kerb is about six inches. */
const KERB_H = 0.14;
const PAVEMENT_Z = ROAD_Z + KERB_H;

type Mesh = { position: number[]; index: number[] };

/**
 * The unit normal at each vertex — the average of its two adjacent edges, so a
 * bend keeps a constant width instead of pinching on the inside.
 */
function normalsFor(path: [number, number][]): [number, number][] {
  return path.map((_, i) => {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy);
    return len > 1e-6
      ? ([dy / len, -dx / len] as [number, number])
      : ([0, 0] as [number, number]);
  });
}

/**
 * A flat strip of the given width, its centre `offset` metres to the side of
 * the path. Offset zero gives the roadbed; ±(half + pavement/2) gives the two
 * footways.
 */
function ribbon(
  path: [number, number][],
  offset: number,
  halfWidth: number,
  z: number,
  out: Mesh,
): void {
  if (path.length < 2 || halfWidth <= 0) return;

  const normals = normalsFor(path);
  const base = out.position.length / 3;
  for (let i = 0; i < path.length; i++) {
    const [nx, ny] = normals[i];
    const cx = path[i][0] + nx * offset;
    const cy = path[i][1] + ny * offset;
    out.position.push(cx + nx * halfWidth, cy + ny * halfWidth, z);
    out.position.push(cx - nx * halfWidth, cy - ny * halfWidth, z);
  }

  for (let i = 0; i < path.length - 1; i++) {
    const a = base + i * 2;
    // Wound anticlockwise seen from above, which is the direction that faces
    // the sky — see `WINDING` below.
    out.index.push(a, a + 3, a + 1, a, a + 2, a + 3);
  }
}

/**
 * ### WINDING
 *
 * Every horizontal strip here is wound so that its front face points at the
 * sky, and that is not a detail: the first version wound them the other way and
 * **the entire streetscape was invisible**. Not dim, not z-fighting — culled.
 *
 * The trap is that the winding does not depend on which way the road runs. The
 * strip's normal is derived from the direction of travel, so reversing the road
 * reverses the normal too and the triangles come out clockwise either way.
 * Every road in Manhattan was therefore back-facing at once, which looks
 * exactly like the geometry never having been built — and it cost a lot of time
 * spent checking that it had been. The tell was that the cars, which are
 * closed boxes, were visible and driving down roads that were not there.
 *
 * The kerb faces are vertical and are drawn from both offsets, so they use a
 * double-sided material instead and are exempt from this.
 */

/**
 * The vertical face of the kerb: the same line as the roadbed edge, extruded
 * from road level to pavement level.
 *
 * Double-sided is not needed — it is drawn from both offsets, so each side of
 * the street presents its own outward face to the street.
 */
function kerbFace(
  path: [number, number][],
  offset: number,
  out: Mesh,
): void {
  if (path.length < 2) return;
  const normals = normalsFor(path);
  const base = out.position.length / 3;
  for (let i = 0; i < path.length; i++) {
    const [nx, ny] = normals[i];
    const x = path[i][0] + nx * offset;
    const y = path[i][1] + ny * offset;
    out.position.push(x, y, ROAD_Z);
    out.position.push(x, y, PAVEMENT_Z);
  }
  for (let i = 0; i < path.length - 1; i++) {
    const a = base + i * 2;
    out.index.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
}

/** Dash geometry, in metres: three on, six off, 0.12 m wide. */
const DASH_ON = 3;
const DASH_OFF = 6;
const DASH_HALF = 0.06;

/**
 * A broken lane line down the middle of the carriageway.
 *
 * The art direction asks for clean streets with no decals, and this is the one
 * exception, argued rather than assumed: a lane line is not grime or signage,
 * it is the thing that makes an expanse of grey read as a road at eye level. It
 * is drawn in the pavement's own tone rather than in white, so it is a texture
 * on the surface at fifty metres and gone at two hundred — which is the
 * opposite of how a decal behaves and the point of doing it this way.
 *
 * Only on roads wide enough to have more than one lane each way; a 24-foot side
 * street striped down the middle looks like a runway.
 */
function laneDashes(path: [number, number][], out: Mesh): void {
  if (path.length < 2) return;
  const normals = normalsFor(path);

  const period = DASH_ON + DASH_OFF;
  let travelled = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, y0] = path[i];
    const [x1, y1] = path[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const [nx, ny] = normals[i];

    /**
     * The dash phase carries across vertices, so a bend does not restart the
     * pattern and produce a cluster of stubs at every kink in the centreline.
     * `travelled` is distance from the start of the whole polyline; the loop
     * begins at the last dash boundary at or before this segment's start, which
     * may be negative — a dash straddling the vertex, correctly clipped.
     */
    for (let s = -(travelled % period); s < len; s += period) {
      const a = Math.max(0, s);
      const b = Math.min(len, s + DASH_ON);
      if (b <= a) continue;
      const base = out.position.length / 3;
      for (const t of [a / len, b / len]) {
        const px = x0 + dx * t;
        const py = y0 + dy * t;
        out.position.push(px + nx * DASH_HALF, py + ny * DASH_HALF, MARKING_Z);
        out.position.push(px - nx * DASH_HALF, py - ny * DASH_HALF, MARKING_Z);
      }
      // Sky-facing, for the reason set out under WINDING.
      out.index.push(base, base + 3, base + 1, base, base + 2, base + 3);
    }
    travelled += len;
  }
}

export interface StreetsHandle {
  /**
   * Everything the streetscape draws, as one node.
   *
   * It used to be two meshes the caller added and removed by hand, which stops
   * scaling the moment there are four of them — a kerb or a lane line that is
   * built but never parented is a silent, invisible bug, and the caller has no
   * business knowing how many surfaces a street is made of.
   */
  group: THREE.Group;
  dispose(): void;
  triangles: number;
}

/**
 * Wide enough to be worth a lane line. 40 published feet is roughly four lanes
 * kerb to kerb — an avenue and the larger cross-streets, not a side street.
 */
const LANE_LINE_MIN_FT = 40;

/** Drivable roads only. A step street is not somewhere a car goes. */
function drivable(road: RoadSegment): boolean {
  return road.p.length >= 2 && road.w > 0;
}

export function makeStreets(
  frame: LocalFrame,
  streetscape: StreetscapeResult,
  preset: AtmospherePreset,
): StreetsHandle | null {
  const roads: Mesh = { position: [], index: [] };
  const pavements: Mesh = { position: [], index: [] };
  const kerbs: Mesh = { position: [], index: [] };
  const markings: Mesh = { position: [], index: [] };

  for (const road of streetscape.roads) {
    if (!drivable(road)) continue;
    const path = ringToLocal(frame, road.p);
    const half = (road.w * 0.3048) / 2;

    ribbon(path, 0, half, ROAD_Z, roads);
    for (const side of [1, -1]) {
      ribbon(path, side * (half + PAVEMENT_M / 2), PAVEMENT_M / 2, PAVEMENT_Z, pavements);
      kerbFace(path, side * half, kerbs);
    }
    if (road.w >= LANE_LINE_MIN_FT) laneDashes(path, markings);
  }

  if (roads.index.length === 0) return null;

  const ground = groundColor(preset);
  /**
   * Roadbed darker than pavement, pavement lighter than the plane underneath.
   *
   * The first pair were four percent apart and the street did not read at
   * all — a pale mass with cars sliding across it. The art direction asks for
   * clean pale streets with no grime and no decals, and it is satisfied by
   * near-white surfaces that differ; it is not satisfied by surfaces so close
   * together that the kerb line disappears. These two are about forty percent
   * apart and still contain no colour at all, which is the constraint that
   * actually matters.
   */
  const roadMaterial = new THREE.MeshBasicMaterial({
    color: ground.clone().multiplyScalar(0.80),
  });
  const pavementMaterial = new THREE.MeshBasicMaterial({
    color: ground.clone().multiplyScalar(1.22),
  });
  /**
   * The kerb face is darker than the footway it belongs to.
   *
   * Nothing in this scene is lit, so a vertical surface drawn in the same tone
   * as the horizontal one above it disappears into it and the kerb reads as a
   * painted line. Darkening it is what an ambient-occluded corner would have
   * done, at no cost.
   */
  const kerbMaterial = new THREE.MeshBasicMaterial({
    color: ground.clone().multiplyScalar(0.95),
    side: THREE.DoubleSide,
  });
  const markingMaterial = new THREE.MeshBasicMaterial({
    color: ground.clone().multiplyScalar(1.35),
  });

  const build = (data: Mesh, material: THREE.Material, order: number): THREE.Mesh => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
    g.setIndex(data.index);
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = false;
    // Below every building and above the ground plane.
    mesh.renderOrder = order;
    return mesh;
  };

  const group = new THREE.Group();
  const meshes = [
    build(roads, roadMaterial, -8),
    build(markings, markingMaterial, -7),
    build(kerbs, kerbMaterial, -7),
    build(pavements, pavementMaterial, -7),
  ];
  for (const mesh of meshes) group.add(mesh);
  const materials = [roadMaterial, markingMaterial, kerbMaterial, pavementMaterial];

  return {
    group,
    triangles:
      (roads.index.length + pavements.index.length +
        kerbs.index.length + markings.index.length) / 3,
    dispose() {
      for (const mesh of meshes) mesh.geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
