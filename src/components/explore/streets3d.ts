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
 * Three surfaces, three heights, all within four centimetres of each other,
 * because they are coplanar in every sense that matters and the depth buffer
 * has to be told which is on top:
 *
 * | Surface | z |
 * |---|---|
 * | Ground plane | −0.05 m |
 * | Pavement | +0.00 m |
 * | Roadbed | +0.02 m |
 */

/** Metres of pavement either side of the roadbed. */
const PAVEMENT_M = 3.2;

const ROAD_Z = 0.02;
const PAVEMENT_Z = 0.0;

function ribbon(
  path: [number, number][],
  halfWidth: number,
  z: number,
  out: { position: number[]; index: number[] },
): void {
  if (path.length < 2 || halfWidth <= 0) return;

  const base = out.position.length / 3;
  for (let i = 0; i < path.length; i++) {
    // The normal at a vertex is the average of its two adjacent edges, so a
    // bend keeps a constant width instead of pinching on the inside.
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy);
    const nx = len > 1e-6 ? dy / len : 0;
    const ny = len > 1e-6 ? -dx / len : 0;

    out.position.push(path[i][0] + nx * halfWidth, path[i][1] + ny * halfWidth, z);
    out.position.push(path[i][0] - nx * halfWidth, path[i][1] - ny * halfWidth, z);
  }

  for (let i = 0; i < path.length - 1; i++) {
    const a = base + i * 2;
    out.index.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
}

export interface StreetsHandle {
  roads: THREE.Mesh;
  pavements: THREE.Mesh;
  dispose(): void;
  triangles: number;
}

/** Drivable roads only. A step street is not somewhere a car goes. */
function drivable(road: RoadSegment): boolean {
  return road.p.length >= 2 && road.w > 0;
}

export function makeStreets(
  frame: LocalFrame,
  streetscape: StreetscapeResult,
  preset: AtmospherePreset,
): StreetsHandle | null {
  const roads = { position: [] as number[], index: [] as number[] };
  const pavements = { position: [] as number[], index: [] as number[] };

  for (const road of streetscape.roads) {
    if (!drivable(road)) continue;
    const path = ringToLocal(frame, road.p);
    const half = (road.w * 0.3048) / 2;
    ribbon(path, half, ROAD_Z, roads);
    ribbon(path, half + PAVEMENT_M, PAVEMENT_Z, pavements);
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

  const build = (
    data: { position: number[]; index: number[] },
    material: THREE.Material,
  ): THREE.Mesh => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
    g.setIndex(data.index);
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = false;
    return mesh;
  };

  const roadMesh = build(roads, roadMaterial);
  const pavementMesh = build(pavements, pavementMaterial);
  // Below every building and above the ground plane.
  pavementMesh.renderOrder = -8;
  roadMesh.renderOrder = -7;

  return {
    roads: roadMesh,
    pavements: pavementMesh,
    triangles: (roads.index.length + pavements.index.length) / 3,
    dispose() {
      roadMesh.geometry.dispose();
      pavementMesh.geometry.dispose();
      roadMaterial.dispose();
      pavementMaterial.dispose();
    },
  };
}
