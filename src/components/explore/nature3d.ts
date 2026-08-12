import * as THREE from 'three';
import type { AtmospherePreset } from '../map/atmosphere';
import type { StreetscapeResult } from '@/lib/streetscape';
import { ringToLocal, openRing, toCCW, type LocalFrame } from '@/lib/explore/frame';
import { triangulate } from '@/lib/explore/tessellate';

/**
 * The green: parks as grass, street trees as trees.
 *
 * The flat map already draws both, and Explore mode could not — an opaque park
 * on deck.gl's canvas paints over the towers standing beside it, the same
 * compositing fact that moved the streets and the bands into three.js. So
 * until now every park in the model was a patch of pavement and every street
 * tree was nothing at all, which on an island whose most famous feature is a
 * park is a conspicuous absence.
 *
 * ## The colour problem, and how far it is allowed to go
 *
 * Green is a hue, and this product has exactly one hue: the Goldenrod of an
 * available floor is the loudest thing on screen and nothing is permitted to
 * compete with it. A saturated lawn is a large, bright, *coloured* area — the
 * one thing that would.
 *
 * So the green here is heavily desaturated and darkened toward the ground
 * plane it sits on: enough to read unmistakably as planting rather than as
 * paving, nowhere near enough to read as colour. Central Park at this
 * treatment is a soft grey-green field, which is both what it looks like from
 * a tower on a hazy day and the most it can be allowed to be.
 *
 * ## Trees
 *
 * Two instanced meshes — trunk and canopy — so the whole borough's street
 * trees are two draw calls. The canopy is a six-sided sphere: at the size a
 * street tree occupies on screen the silhouette is everything and the facets
 * are invisible, and a proper sphere would multiply the triangle count by
 * eight for nothing.
 */

/**
 * Beyond this many, a tree is texture and the budget is better spent.
 *
 * 3,000 was the first figure and it cost more than it was worth: the trees
 * alone were 180,000 triangles — a third of the whole scene — and pushed the
 * frame past the harness's catastrophe ceiling. At 1,600 a Manhattan street
 * still has a line of trees down it, because the data is densest exactly where
 * the camera goes.
 */
const MAX_TREES = 1600;

/** Metres. NYC's street tree data has no crown width, so this is typical. */
const CANOPY_R = 2.6;
const TRUNK_H = 2.4;

export interface NatureHandle {
  group: THREE.Group;
  trees: number;
  triangles: number;
  /** New hour, same triangles — see the note on `StreetsHandle.applyPreset`. */
  applyPreset(preset: AtmospherePreset): void;
  dispose(): void;
}

/**
 * Planting green, derived from the hour's own ground colour.
 *
 * Derived rather than fixed so the parks track dawn, noon and night with
 * everything else — a lawn that stays the same colour while the city goes dark
 * around it is the thing that makes a night frame look broken.
 */
function greenFor(preset: AtmospherePreset, lift: number): THREE.Color {
  const base = new THREE.Color(preset.horizon);
  // A hue rotation would be the obvious way and it is wrong: it produces a
  // saturated green at midday and a saturated green at night. Mixing toward a
  // muted sage keeps the value tracking the hour and the chroma bounded.
  const sage = new THREE.Color(0.33, 0.44, 0.29);
  return base.clone().lerp(sage, lift);
}

export function makeNature(
  frame: LocalFrame,
  streetscape: StreetscapeResult,
  preset: AtmospherePreset,
): NatureHandle | null {
  const group = new THREE.Group();
  const disposers: (() => void)[] = [];
  let triangles = 0;
  let parkMaterial: THREE.MeshBasicMaterial | null = null;
  let trunkTint: THREE.MeshBasicMaterial | null = null;
  let canopyTint: THREE.MeshBasicMaterial | null = null;

  // --- Parks. Flat fills, a few centimetres above the roadbed so a lawn
  // meeting a pavement has an edge rather than a fight.
  const position: number[] = [];
  const index: number[] = [];
  for (const park of streetscape.parks) {
    // The first ring is the boundary and the rest are holes; the ear clipper
    // has no hole support, so a hole becomes a slightly larger lawn. On a
    // Manhattan park that is a pond drawn as grass — visible only from
    // directly above and not worth a triangulator rewrite.
    for (const ring of park.rings.slice(0, 1)) {
      const local = toCCW(openRing(ringToLocal(frame, ring)));
      if (local.length < 3) continue;
      const base = position.length / 3;
      for (const [x, y] of local) position.push(x, y, 0.06);
      // `triangulate` returns a flat index list. Emitted with the second and
      // third swapped so the fill faces the sky: the ring is wound
      // anticlockwise, which the ear clipper preserves, and a sky-facing
      // triangle needs the opposite — the same trap that made the entire
      // streetscape invisible. See WINDING in `streets3d`.
      const tris = triangulate(local);
      for (let i = 0; i < tris.length; i += 3) {
        index.push(base + tris[i], base + tris[i + 2], base + tris[i + 1]);
      }
    }
  }

  if (index.length > 0) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setIndex(index);
    const material = new THREE.MeshBasicMaterial({ color: greenFor(preset, 0.88) });
    parkMaterial = material;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    // Above the roadbed and the pavement, below every building.
    mesh.renderOrder = -6;
    group.add(mesh);
    triangles += index.length / 3;
    disposers.push(() => {
      geometry.dispose();
      material.dispose();
    });
  }

  // --- Street trees.
  const points = streetscape.trees.slice(0, MAX_TREES);
  if (points.length > 0) {
    const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.2, TRUNK_H, 5);
    // Cylinders are born about +Y; the scene's up is +Z.
    trunkGeometry.rotateX(Math.PI / 2);
    trunkGeometry.translate(0, 0, TRUNK_H / 2);

    const canopyGeometry = new THREE.SphereGeometry(CANOPY_R, 5, 3);
    canopyGeometry.scale(1, 1, 1.15);
    canopyGeometry.translate(0, 0, TRUNK_H + CANOPY_R * 0.75);

    const trunkMaterial = new THREE.MeshBasicMaterial({
      color: greenFor(preset, 0.5).multiplyScalar(0.62),
    });
    const canopyMaterial = new THREE.MeshBasicMaterial({ color: greenFor(preset, 0.94) });
    trunkTint = trunkMaterial;
    canopyTint = canopyMaterial;

    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, points.length);
    const canopies = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, points.length);

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();

    points.forEach((t, i) => {
      const [x, y] = ringToLocal(frame, [t.p])[0];
      pos.set(x, y, 0);
      /**
       * Varied by a hash of the position, not at random.
       *
       * A street of identical trees reads as a repeated asset — the same
       * problem the traffic had — and the same fix: deterministic, so a tree
       * is the same size on every reload, and value-only, so nothing here
       * gains chroma.
       */
      const h = Math.abs(Math.sin((x * 12.9898 + y * 78.233) * 43758.5453)) % 1;
      // The city records trunk diameter, which is the only real size signal in
      // the data — a 30-inch London plane and a newly planted whip should not
      // be the same tree. The hash only varies what the data does not say.
      const fromData = t.d > 0 ? Math.min(1.6, 0.6 + t.d / 26) : 1;
      const k = fromData * (0.85 + h * 0.3);
      scale.set(k, k, k);
      matrix.compose(pos, quaternion, scale);
      trunks.setMatrixAt(i, matrix);
      canopies.setMatrixAt(i, matrix);
    });

    for (const mesh of [trunks, canopies]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      group.add(mesh);
    }

    triangles +=
      ((trunkGeometry.getIndex()?.count ?? 0) + (canopyGeometry.getIndex()?.count ?? 0)) /
      3 *
      points.length;

    disposers.push(() => {
      trunkGeometry.dispose();
      canopyGeometry.dispose();
      trunkMaterial.dispose();
      canopyMaterial.dispose();
    });
  }

  if (group.children.length === 0) return null;

  return {
    group,
    trees: points.length,
    triangles,
    applyPreset(next: AtmospherePreset) {
      // The lift values match the ones the materials were built with, so a
      // re-tint lands on exactly the colour a rebuild would have produced.
      parkMaterial?.color.copy(greenFor(next, 0.88));
      trunkTint?.color.copy(greenFor(next, 0.5).multiplyScalar(0.62));
      canopyTint?.color.copy(greenFor(next, 0.94));
    },
    dispose() {
      for (const d of disposers) d();
    },
  };
}
