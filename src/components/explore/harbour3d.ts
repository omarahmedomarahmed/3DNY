import * as THREE from 'three';
import type { AtmospherePreset } from '../map/atmosphere';
import type { WaterPolygon } from '@/lib/streetscape';
import { pointInRing, ringToLocal, toLocal, type LocalFrame } from '@/lib/explore/frame';

/**
 * The harbour: boats on it, and the Statue of Liberty standing in it.
 *
 * The water itself is `water3d`. This is what makes it read as *New York
 * harbour* rather than as a grey area where the ground stops.
 *
 * ## Boats
 *
 * A river with nothing on it is a river nobody is using, and New York's are
 * among the busiest in the country — the Staten Island ferry alone crosses
 * every fifteen minutes. Two instanced meshes, hull and wheelhouse, so the
 * whole harbour is two draw calls, and a wake behind each one because at this
 * distance the wake is more visible than the boat.
 *
 * They move in straight lines and wrap. There is no vessel traffic data behind
 * this and it does not pretend there is: what it claims is "this water is in
 * use", which is true, and nothing about any particular boat.
 *
 * ## The statue
 *
 * Built rather than downloaded. It is about forty triangles of tapered box and
 * cone at the real coordinates, and at any distance you can see it from — it
 * is two miles from the Battery — that is more than the silhouette needs. A
 * downloaded mesh would be a licence question, a load-order problem and a
 * megabyte, for a shape three hundred pixels tall at most.
 *
 * The torch is the one thing given an emissive colour: after dark it is a lit
 * point on black water, which is exactly what it is in life, and it is small
 * enough that the hierarchy is untouched.
 */

/** Where she stands. Liberty Island, and the plinth's own centre. */
const LIBERTY_LON = -74.04454;
const LIBERTY_LAT = 40.68925;

/** Metres. Pedestal 47 m, statue 46 m, torch at 93 m — the real figures. */
const PEDESTAL_H = 47;
const FIGURE_H = 46;

const MAX_BOATS = 90;
const BOAT_SPEED_MS = 5.5;

export interface HarbourHandle {
  group: THREE.Group;
  boats: number;
  triangles: number;
  /** Advances the boats. Called from the layer's own frame loop. */
  step(dt: number): void;
  applyPreset(preset: AtmospherePreset): void;
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
 * A vessel, facing +X: a 34 m hull with a wheelhouse.
 *
 * One size for everything. A tug, a ferry and a barge are different lengths
 * and this draws them all at the ferry's, which is wrong in a way nobody at
 * two thousand metres can see and right in the way that matters: the thing on
 * the water is boat-shaped and boat-sized.
 */
function boatGeometry(): THREE.BufferGeometry {
  return merge([
    box(34, 9, 3.2, 0, 0, 1.6),
    // A bow, tapered by being narrower and set forward.
    box(8, 5.5, 2.6, 20, 0, 1.5),
    box(11, 7, 4.4, -4, 0, 5.2),
    box(6, 5, 2.6, -4, 0, 8.4),
  ]);
}

/** The wake: a long flat wedge behind the hull, brighter than the water. */
function wakeGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // A triangle fanning out astern, lying on the surface.
  const position = new Float32Array([
    -16, -3.5, 0.05,
    -16, 3.5, 0.05,
    -190, 26, 0.05,
    -16, -3.5, 0.05,
    -190, -26, 0.05,
    -190, 26, 0.05,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  return g;
}

/**
 * Her silhouette, in eight volumes.
 *
 * The star fort, the pedestal, a tapering robe, the raised arm, the torch and
 * the crown. Nothing here is a likeness; it is the outline everybody in the
 * world already knows, which is the only part that has to be right.
 */
function libertyGeometry(): { stone: THREE.BufferGeometry; torch: THREE.BufferGeometry } {
  const fort = new THREE.CylinderGeometry(46, 50, 12, 11);
  fort.rotateX(Math.PI / 2);
  fort.translate(0, 0, 6);

  const plinth = box(26, 26, PEDESTAL_H - 12, 0, 0, 12 + (PEDESTAL_H - 12) / 2);
  const cap = box(30, 30, 2.5, 0, 0, PEDESTAL_H + 1.2);

  // The robe: a tapered cone reads as drapery at any distance that matters.
  const robe = new THREE.CylinderGeometry(4.0, 11.5, FIGURE_H * 0.78, 10);
  robe.rotateX(Math.PI / 2);
  robe.translate(0, 0, PEDESTAL_H + 2.5 + (FIGURE_H * 0.78) / 2);

  const head = new THREE.SphereGeometry(3.4, 8, 6);
  head.translate(0, 0, PEDESTAL_H + 2.5 + FIGURE_H * 0.78 + 2.6);

  // Seven points, because that is the one detail of the crown everyone knows.
  const crownParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const spike = new THREE.ConeGeometry(0.7, 5.5, 4);
    spike.rotateX(Math.PI / 2);
    spike.translate(
      Math.cos(a) * 3.6,
      Math.sin(a) * 3.6,
      PEDESTAL_H + 2.5 + FIGURE_H * 0.78 + 5.4,
    );
    crownParts.push(spike);
  }

  // The arm, raised to the right and forward, and the tablet on the left.
  const armTop = PEDESTAL_H + 2.5 + FIGURE_H * 0.78 + 16;
  const arm = box(2.6, 2.6, 22, 6.5, 0, armTop - 11);
  const tablet = box(1.6, 6.5, 8.5, -7.5, 0, PEDESTAL_H + 2.5 + FIGURE_H * 0.5);

  return {
    stone: merge([fort, plinth, cap, robe, head, arm, tablet, ...crownParts]),
    torch: merge([
      box(3.2, 3.2, 2.2, 6.5, 0, armTop + 1.1),
      new THREE.ConeGeometry(2.0, 4.5, 8).rotateX(Math.PI / 2).translate(6.5, 0, armTop + 4.6),
    ]),
  };
}

interface Boat {
  x: number;
  y: number;
  heading: number;
}

/**
 * Boat positions: rejection-sampled inside the water polygons.
 *
 * Sampling the bounding box and keeping what lands in a ring is crude and is
 * exactly right here — the alternative is a proper polygon sampler for a
 * feature whose requirement is "some boats, roughly where the water is".
 */
function seedBoats(rings: [number, number][][]): Boat[] {
  const out: Boat[] = [];
  if (rings.length === 0) return out;

  for (const ring of rings) {
    if (out.length >= MAX_BOATS) break;
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
    const area = (maxX - minX) * (maxY - minY);
    // Boats in proportion to how much water there is, so the Hudson gets a
    // dozen and a slipway gets none.
    const want = Math.min(24, Math.max(0, Math.round(area / 4_000_000)));

    let tries = 0;
    let placed = 0;
    while (placed < want && tries < want * 60 && out.length < MAX_BOATS) {
      tries++;
      // Deterministic, so the harbour is the same on every reload.
      const h1 = Math.abs(Math.sin((tries * 12.9898 + out.length * 4.1414) * 43758.5453)) % 1;
      const h2 = Math.abs(Math.sin((tries * 78.233 + out.length * 9.7531) * 43758.5453)) % 1;
      const x = minX + h1 * (maxX - minX);
      const y = minY + h2 * (maxY - minY);
      if (!pointInRing(ring, x, y)) continue;
      out.push({ x, y, heading: h1 * Math.PI * 2 });
      placed++;
    }
  }
  return out;
}

export function makeHarbour(
  frame: LocalFrame,
  water: WaterPolygon[],
  preset: AtmospherePreset,
): HarbourHandle {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  let triangles = 0;

  const tone = (base: number) =>
    new THREE.Color(base, base, base).lerp(new THREE.Color(preset.horizon), 0.3);

  // --- Boats.
  const rings = water
    .map((w) => w.rings[0])
    .filter((r): r is [number, number][] => Boolean(r) && r.length >= 4)
    .map((r) => ringToLocal(frame, r));
  const boats = seedBoats(rings);

  let hulls: THREE.InstancedMesh | null = null;
  let wakes: THREE.InstancedMesh | null = null;

  if (boats.length > 0) {
    const hullGeometry = boatGeometry();
    const wakeMesh = wakeGeometry();
    const hullMaterial = new THREE.MeshBasicMaterial({ color: tone(0.42) });
    const wakeMaterial = new THREE.MeshBasicMaterial({
      color: tone(1.0),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    hulls = new THREE.InstancedMesh(hullGeometry, hullMaterial, boats.length);
    wakes = new THREE.InstancedMesh(wakeMesh, wakeMaterial, boats.length);
    for (const mesh of [wakes, hulls]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    // Above the water surface, below everything on land.
    wakes.renderOrder = -8;
    geometries.push(hullGeometry, wakeMesh);
    materials.push(hullMaterial, wakeMaterial);
    triangles += boats.length * 26;
  }

  // --- The statue.
  const [lx, ly] = toLocal(frame, LIBERTY_LON, LIBERTY_LAT);
  const liberty = libertyGeometry();
  const stoneMaterial = new THREE.MeshBasicMaterial({
    // Weathered copper is famously green, and this is the one place in the
    // model where that hue is unavoidable. It is a single object a hundred
    // pixels tall from anywhere in Manhattan, so it cannot threaten anything —
    // and desaturating it into a grey statue would be its own kind of wrong.
    color: new THREE.Color(0.62, 0.74, 0.68).lerp(new THREE.Color(preset.horizon), 0.28),
  });
  const torchMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.0, 0.88, 0.62),
  });

  const stoneMesh = new THREE.Mesh(liberty.stone, stoneMaterial);
  const torchMesh = new THREE.Mesh(liberty.torch, torchMaterial);
  for (const mesh of [stoneMesh, torchMesh]) {
    mesh.position.set(lx, ly, 0);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  geometries.push(liberty.stone, liberty.torch);
  materials.push(stoneMaterial, torchMaterial);
  triangles +=
    ((liberty.stone.getIndex()?.count ?? 0) + (liberty.torch.getIndex()?.count ?? 0)) / 3;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 0, 1);

  const write = () => {
    if (!hulls || !wakes) return;
    boats.forEach((b, i) => {
      quaternion.setFromAxisAngle(up, b.heading);
      position.set(b.x, b.y, 0);
      matrix.compose(position, quaternion, scale);
      hulls.setMatrixAt(i, matrix);
      wakes.setMatrixAt(i, matrix);
    });
    hulls.instanceMatrix.needsUpdate = true;
    wakes.instanceMatrix.needsUpdate = true;
  };
  write();

  return {
    group,
    boats: boats.length,
    triangles,
    step(dt: number) {
      if (boats.length === 0 || dt <= 0) return;
      for (const b of boats) {
        b.x += Math.sin(b.heading) * BOAT_SPEED_MS * dt;
        b.y += Math.cos(b.heading) * BOAT_SPEED_MS * dt;
      }
      write();
    },
    applyPreset(next: AtmospherePreset) {
      const t = (base: number) =>
        new THREE.Color(base, base, base).lerp(new THREE.Color(next.horizon), 0.3);
      (materials[0] as THREE.MeshBasicMaterial | undefined)?.color.copy(t(0.42));
      stoneMaterial.color
        .set(0x9ebdac)
        .lerp(new THREE.Color(next.horizon), 0.28);
      /**
       * The torch is the only thing here that gets brighter after dark.
       *
       * By day it is a warm point on a lit statue and nobody would notice it
       * missing. At night it is the thing you can see from the Battery, and
       * that is not decoration — it is the reason anyone looks that way.
       */
      const lit = next.key === 'night' ? 1.0 : next.key === 'golden' ? 0.8 : 0.55;
      torchMaterial.color.setRGB(1.0 * lit, 0.88 * lit, 0.62 * lit);
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      stoneMaterial.dispose();
      torchMaterial.dispose();
    },
  };
}
