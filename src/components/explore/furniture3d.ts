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
 * one.** This project holds no drawings for these spaces. So the fit-out is
 * generic, obviously generic, and identical in kind everywhere: an open-plan
 * grid of desks on a 3.2 m module, the spacing a landlord's marketing plan
 * assumes, with meeting rooms only where the plate is deep enough to have
 * them. It is furniture-as-a-ruler, not furniture-as-a-claim, and the card in
 * the corner says so.
 *
 * Everything is pale grey and unlit, like the plate it sits on. Anything with
 * colour in it would compete with the availability bands on the towers
 * outside the window, which is the one thing this product does not allow.
 *
 * ## Cost
 *
 * One `InstancedMesh` per part — desk, chair, screen — so a fully furnished
 * floor is three draw calls whatever its size. A 40,000 SF plate takes about
 * 350 desks, which is roughly 12,000 triangles: a rounding error against the
 * two-million budget, and it only exists while you are inside.
 */

/** The planning module. 3.2 m is a bay and a half; a desk cluster fits it. */
const MODULE_M = 3.2;

/** Kept clear of the glass, so nobody's monitor is embedded in the facade. */
const PERIMETER_M = 2.4;

/** Beyond this many desks the plate is enormous and the point is made. */
const MAX_DESKS = 600;

export interface FurnitureHandle {
  group: THREE.Group;
  desks: number;
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
 * A desk: a 1.6 × 0.8 m top on two panel legs, at 0.73 m — the height every
 * office desk in the world is, which is exactly why it works as a ruler.
 */
function deskGeometry(): THREE.BufferGeometry {
  return merge([
    box(1.6, 0.8, 0.04, 0, 0, 0.73),
    box(0.06, 0.7, 0.71, -0.74, 0, 0.36),
    box(0.06, 0.7, 0.71, 0.74, 0, 0.36),
  ]);
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

/**
 * Desk positions on a grid, clipped to the plate.
 *
 * The grid is axis-aligned to the scene rather than to the building, which is
 * wrong in the way that does not matter — Manhattan's grid is 29 degrees off
 * north and so is every floor plate on it, but a desk layout reads as a desk
 * layout at any angle, and aligning to each plate's own long axis is a
 * principal-axis calculation for no visible gain.
 *
 * A position is kept only if it is inside the ring *and* a clear distance from
 * the glass, which is what stops a row of desks poking through the facade on a
 * plate with a diagonal edge.
 */
export function deskPositions(inside: Inside): [number, number][] {
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

  const out: [number, number][] = [];
  for (let x = minX + MODULE_M / 2; x <= maxX && out.length < MAX_DESKS; x += MODULE_M) {
    for (let y = minY + MODULE_M / 2; y <= maxY && out.length < MAX_DESKS; y += MODULE_M) {
      if (!pointInRing(ring, x, y)) continue;
      if (nearestEdge(ring, x, y).distance < PERIMETER_M) continue;
      out.push([x, y]);
    }
  }
  return out;
}

export function makeFurniture(
  inside: Inside,
  preset: AtmospherePreset,
): FurnitureHandle | null {
  const spots = deskPositions(inside);
  if (spots.length === 0) return null;

  const deskMaterial = partMaterial(preset, 0.88);
  const chairMaterial = partMaterial(preset, 0.52);
  const screenMaterial = partMaterial(preset, 0.34);

  const desks = new THREE.InstancedMesh(deskGeometry(), deskMaterial, spots.length);
  const chairs = new THREE.InstancedMesh(chairGeometry(), chairMaterial, spots.length);
  const screens = new THREE.InstancedMesh(screenGeometry(), screenMaterial, spots.length);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 0, 1);

  spots.forEach(([x, y], i) => {
    // Desks face alternate ways down the row, as benching does.
    const facing = (i % 2 === 0 ? 0 : Math.PI);
    quaternion.setFromAxisAngle(up, facing);

    position.set(x, y, inside.floorM + 0.02);
    matrix.compose(position, quaternion, scale);
    desks.setMatrixAt(i, matrix);
    screens.setMatrixAt(i, matrix);

    // The chair is pulled back from the desk, on the side you sit.
    position.set(x - Math.sin(facing) * 0.0, y - Math.cos(facing) * 0.78, inside.floorM + 0.02);
    matrix.compose(position, quaternion, scale);
    chairs.setMatrixAt(i, matrix);
  });

  const group = new THREE.Group();
  for (const mesh of [desks, chairs, screens]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  const perInstance =
    (desks.geometry.getIndex()?.count ?? 0) +
    (chairs.geometry.getIndex()?.count ?? 0) +
    (screens.geometry.getIndex()?.count ?? 0);

  return {
    group,
    desks: spots.length,
    triangles: (perInstance / 3) * spots.length,
    dispose() {
      for (const mesh of [desks, chairs, screens]) mesh.geometry.dispose();
      deskMaterial.dispose();
      chairMaterial.dispose();
      screenMaterial.dispose();
    },
  };
}
