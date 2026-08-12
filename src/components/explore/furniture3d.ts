import * as THREE from 'three';
import type { AtmospherePreset } from '../map/atmosphere';
import type { Inside } from '@/lib/explore/walk';
import { nearestEdge, pointInRing } from '@/lib/explore/frame';

/**
 * A default fit-out, so a floor plate reads as an office.
 *
 * ## Why this exists at all
 *
 * An empty plate is honest and useless. Standing on a flat grey slab with
 * glass around it, a 4,000 SF floor and a 40,000 SF floor look identical: there
 * is nothing in the frame whose size anybody knows, so the eye has no scale to
 * work from and the one question the mode exists to answer — *how big is this*
 * — goes unanswered. A desk is 1.6 m across and everyone has stood next to one.
 *
 * ## What it is not
 *
 * **It is not this tenant's floor plan, and it must never be mistaken for
 * one.** This project holds no drawings for these spaces. What it is instead
 * is the arrangement almost every Manhattan floor plate is fitted out in:
 * cellular offices round the perimeter where the daylight is, a meeting room
 * or two, and open-plan benching through the middle where there is none. On a
 * 3.2 m planning module, which is what a landlord's own marketing plan uses.
 *
 * The first version was one grid of identical desks, and it was not enough: it
 * told you the floor was big and nothing else. What a broker is reading when
 * they look at a plate is *how deep it is* — how much of it can have a window
 * and how much cannot — and that is exactly what a perimeter of offices
 * against a core of benching makes visible.
 *
 * It is furniture-as-a-ruler, not furniture-as-a-claim, and the card in the
 * corner says so.
 *
 * Everything is pale grey and unlit, like the plate it sits on. Anything with
 * colour in it would compete with the availability bands on the towers
 * outside the window, which is the one thing this product does not allow.
 *
 * ## Cost
 *
 * One `InstancedMesh` per part — bench desk, L-desk, table, chair, screen —
 * plus one merged mesh for the partitions, so a fully furnished floor is six
 * draw calls whatever its size. It only exists while you are inside.
 */

/** The planning module. 3.2 m is a bay and a half; a desk cluster fits it. */
const MODULE_M = 3.2;

/** Kept clear of the glass, so nobody's monitor is embedded in the facade. */
const PERIMETER_M = 2.4;

/** Beyond this many modules the plate is enormous and the point is made. */
const MAX_MODULES = 700;

/**
 * How deep the private offices run from the glass.
 *
 * One module. A perimeter office in New York is about 3 m deep and 3–4 m wide,
 * which is what a single module already is — the grid was chosen to match a
 * planning module precisely so that it could be read either way.
 */
const OFFICE_BAND_M = 5.4;

const WALL_H = 2.7;

export interface FurnitureHandle {
  group: THREE.Group;
  desks: number;
  offices: number;
  triangles: number;
  dispose(): void;
}

function box(
  sx: number, sy: number, sz: number,
  x: number, y: number, z: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

/** Several boxes into one geometry. Same trick as the traffic. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const position: number[] = [];
  const index: number[] = [];
  let offset = 0;
  for (const part of parts) {
    const p = part.getAttribute('position');
    const idx = part.getIndex();
    for (let i = 0; i < p.count; i++) position.push(p.getX(i), p.getY(i), p.getZ(i));
    if (idx) for (let i = 0; i < idx.count; i++) index.push(offset + idx.getX(i));
    offset += p.count;
    part.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setIndex(index);
  return g;
}

/**
 * A bench desk: a 1.6 × 0.8 m top on two panel legs, at 0.73 m — the height
 * every office desk in the world is, which is exactly why it works as a ruler.
 */
function benchDeskGeometry(): THREE.BufferGeometry {
  return merge([
    box(1.6, 0.8, 0.04, 0, 0, 0.73),
    box(0.06, 0.7, 0.71, -0.74, 0, 0.36),
    box(0.06, 0.7, 0.71, 0.74, 0, 0.36),
  ]);
}

/**
 * An L-desk with a return, which is what a private office actually contains.
 *
 * The return is the give-away: an open-plan floor is rows of rectangles and a
 * cellular floor is L-shapes against walls, and telling them apart at a glance
 * is most of what someone is doing when they look at a fit-out.
 */
function lDeskGeometry(): THREE.BufferGeometry {
  return merge([
    box(1.7, 0.8, 0.04, 0, 0, 0.73),
    box(0.8, 1.2, 0.04, 0.45, -0.9, 0.73),
    box(0.06, 0.7, 0.71, -0.79, 0, 0.36),
    box(0.06, 0.7, 0.71, 0.79, 0, 0.36),
    box(0.7, 0.06, 0.71, 0.45, -1.42, 0.36),
    // A low credenza, because a cellular office always has one.
    box(1.5, 0.45, 0.72, 0, 1.0, 0.36),
  ]);
}

/** A round meeting table with a pedestal base. */
function tableGeometry(): THREE.BufferGeometry {
  const top = new THREE.CylinderGeometry(0.75, 0.75, 0.05, 12);
  top.rotateX(Math.PI / 2);
  top.translate(0, 0, 0.73);
  const post = new THREE.CylinderGeometry(0.09, 0.09, 0.7, 6);
  post.rotateX(Math.PI / 2);
  post.translate(0, 0, 0.35);
  const foot = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 10);
  foot.rotateX(Math.PI / 2);
  foot.translate(0, 0, 0.02);
  return merge([top, post, foot]);
}

/** A task chair, abstracted to a seat, a back and a post. */
function chairGeometry(): THREE.BufferGeometry {
  return merge([
    box(0.48, 0.46, 0.06, 0, 0, 0.45),
    box(0.44, 0.06, 0.44, 0, -0.22, 0.70),
    box(0.08, 0.08, 0.42, 0, 0, 0.22),
    box(0.46, 0.46, 0.04, 0, 0, 0.03),
  ]);
}

/** A monitor on a stand: the thing that says "somebody works here". */
function screenGeometry(): THREE.BufferGeometry {
  return merge([
    box(0.54, 0.03, 0.33, 0, 0, 0.99),
    box(0.06, 0.06, 0.16, 0, 0, 0.82),
    box(0.22, 0.16, 0.02, 0, 0, 0.75),
  ]);
}

/**
 * Unlit greys, a little apart from the slab.
 *
 * The slab is 0.80; furniture sits either side of it so the plane and the
 * things on it never merge into one field of grey. No colour, for the reason
 * in the file header.
 */
function partMaterial(preset: AtmospherePreset, base: number): THREE.MeshBasicMaterial {
  const horizon = new THREE.Color(preset.horizon);
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(base, base, base).lerp(horizon, 0.22),
  });
}

/** A stable 0–1 from a grid cell, so a floor is laid out the same every visit. */
function cellHash(i: number, j: number, salt: number): number {
  return Math.abs(Math.sin((i * 127.1 + j * 311.7 + salt) * 43758.5453)) % 1;
}

export type CellKind = 'office' | 'meeting' | 'open';

export interface Cell {
  x: number;
  y: number;
  i: number;
  j: number;
  kind: CellKind;
}

/**
 * The layout: perimeter offices, a meeting suite, open plan in the middle.
 *
 * This is the arrangement almost every Manhattan floor plate is fitted out in,
 * and it is the one that makes the depth of a plate legible — cellular against
 * the glass, benching in the space that has no daylight. A single grid of
 * identical desks, which is what this was, tells you the floor is big and
 * nothing else.
 *
 * Which cells become what is decided by a hash of the cell's own coordinates,
 * so the same floor is laid out identically on every visit and two different
 * floors are laid out differently. It is not this tenant's plan and does not
 * claim to be — see the file header.
 */
export function layoutCells(inside: Inside): Cell[] {
  const ring = inside.ring;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return [];

  // A salt per floor, so floor 12 and floor 31 of the same tower are not the
  // same room twice.
  const salt = Math.round(inside.floorM * 7.3);

  const out: Cell[] = [];
  let i = 0;
  for (let x = minX + MODULE_M / 2; x <= maxX && out.length < MAX_MODULES; x += MODULE_M, i++) {
    let j = 0;
    for (let y = minY + MODULE_M / 2; y <= maxY && out.length < MAX_MODULES; y += MODULE_M, j++) {
      if (!pointInRing(ring, x, y)) continue;
      const edge = nearestEdge(ring, x, y).distance;
      if (edge < PERIMETER_M) continue;

      const h = cellHash(i, j, salt);
      let kind: CellKind = 'open';
      if (edge < OFFICE_BAND_M) {
        // Perimeter: mostly cellular, in runs rather than one cell at a time —
        // a single office marooned between open desks is not a plan anyone
        // has ever drawn.
        kind = cellHash(Math.floor(i / 2), Math.floor(j / 2), salt) > 0.42 ? 'office' : 'open';
      } else if (h > 0.93) {
        kind = 'meeting';
      }
      out.push({ x, y, i, j, kind });
    }
  }
  return out;
}

/** Back-compatible: where a desk of any kind goes. Used by the tests. */
export function deskPositions(inside: Inside): [number, number][] {
  return layoutCells(inside).map((c) => [c.x, c.y] as [number, number]);
}

export function makeFurniture(
  inside: Inside,
  preset: AtmospherePreset,
): FurnitureHandle | null {
  const cells = layoutCells(inside);
  if (cells.length === 0) return null;

  const z = inside.floorM + 0.02;
  const open = cells.filter((c) => c.kind === 'open');
  const offices = cells.filter((c) => c.kind === 'office');
  const meetings = cells.filter((c) => c.kind === 'meeting');

  const deskMaterial = partMaterial(preset, 0.88);
  const chairMaterial = partMaterial(preset, 0.52);
  const screenMaterial = partMaterial(preset, 0.34);
  // Partitions are glass-and-frame in every fit-out built since about 2005,
  // so they are pale and slightly translucent rather than solid drywall —
  // which also stops a cellular perimeter from walling the view off.
  const wallMaterial = new THREE.MeshBasicMaterial({
    color: partMaterial(preset, 0.93).color,
    transparent: true,
    opacity: 0.30,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [
    deskMaterial,
    chairMaterial,
    screenMaterial,
    wallMaterial,
  ];
  let triangles = 0;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 0, 1);

  const addInstanced = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    places: { x: number; y: number; facing: number }[],
  ) => {
    if (places.length === 0) {
      geometry.dispose();
      return;
    }
    const mesh = new THREE.InstancedMesh(geometry, material, places.length);
    places.forEach((p, k) => {
      quaternion.setFromAxisAngle(up, p.facing);
      position.set(p.x, p.y, z);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(k, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    geometries.push(geometry);
    triangles += ((geometry.getIndex()?.count ?? 0) / 3) * places.length;
  };

  // --- Open plan: benching, alternating direction down the row.
  const benchPlaces = open.map((c) => ({
    x: c.x,
    y: c.y,
    facing: c.j % 2 === 0 ? 0 : Math.PI,
  }));
  addInstanced(benchDeskGeometry(), deskMaterial, benchPlaces);
  addInstanced(screenGeometry(), screenMaterial, benchPlaces);

  // --- Private offices: an L-desk turned to face into the room.
  const officePlaces = offices.map((c) => ({
    x: c.x,
    y: c.y,
    facing: (Math.floor(cellHash(c.i, c.j, 11) * 4) * Math.PI) / 2,
  }));
  addInstanced(lDeskGeometry(), deskMaterial, officePlaces);

  // --- Meeting rooms: a round table.
  const meetingPlaces = meetings.map((c) => ({ x: c.x, y: c.y, facing: 0 }));
  addInstanced(tableGeometry(), deskMaterial, meetingPlaces);

  // --- Chairs: one behind every desk, four round every table.
  const chairPlaces: { x: number; y: number; facing: number }[] = [];
  for (const p of benchPlaces) {
    chairPlaces.push({ x: p.x, y: p.y - Math.cos(p.facing) * 0.78, facing: p.facing });
  }
  for (const p of officePlaces) {
    chairPlaces.push({ x: p.x, y: p.y, facing: p.facing + Math.PI });
  }
  for (const p of meetingPlaces) {
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      chairPlaces.push({
        x: p.x + Math.sin(a) * 1.15,
        y: p.y + Math.cos(a) * 1.15,
        facing: a + Math.PI,
      });
    }
  }
  addInstanced(chairGeometry(), chairMaterial, chairPlaces);

  /**
   * Partitions, built where a cellular cell meets one that is not.
   *
   * Walls only on the boundary, so a run of three offices reads as three rooms
   * off one corridor rather than as three boxes with double walls between
   * them. Merged into one geometry rather than instanced because every wall is
   * in a different place and orientation and there are only a few dozen.
   */
  const cellular = new Set<string>();
  for (const c of [...offices, ...meetings]) cellular.add(`${c.i}:${c.j}`);

  const wallParts: THREE.BufferGeometry[] = [];
  const half = MODULE_M / 2;
  for (const c of [...offices, ...meetings]) {
    const neighbours: [number, number, number, number][] = [
      // di, dj, wall centre offset x, y
      [1, 0, half, 0],
      [-1, 0, -half, 0],
      [0, 1, 0, half],
      [0, -1, 0, -half],
    ];
    for (const [di, dj, ox, oy] of neighbours) {
      if (cellular.has(`${c.i + di}:${c.j + dj}`)) continue;
      const along = di === 0 ? MODULE_M : 0.08;
      const across = di === 0 ? 0.08 : MODULE_M;
      // A gap in one wall per room is the door, and a room with no door reads
      // as a display case.
      if (cellHash(c.i, c.j, di * 3 + dj * 7) > 0.72) continue;
      wallParts.push(box(along, across, WALL_H, c.x + ox, c.y + oy, z + WALL_H / 2));
    }
  }

  if (wallParts.length > 0) {
    const wallGeometry = merge(wallParts);
    const mesh = new THREE.Mesh(wallGeometry, wallMaterial);
    mesh.frustumCulled = false;
    // Transparent, so after the opaque furniture it stands in front of.
    mesh.renderOrder = 11;
    group.add(mesh);
    geometries.push(wallGeometry);
    triangles += (wallGeometry.getIndex()?.count ?? 0) / 3;
  }

  return {
    group,
    desks: open.length + offices.length,
    offices: offices.length,
    triangles,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
