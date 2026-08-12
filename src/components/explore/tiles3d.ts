import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import type { AtmospherePreset } from '../map/atmosphere';
import { makeFacadeMaterial, updateFacadeUniforms, applyPreset } from './materials';

/**
 * The surrounding city, streamed as 3-D Tiles.
 *
 * ## What this is for
 *
 * Every building in Manhattan, with its real surveyed shape and its real roof,
 * at a cost that does not depend on how many there are. The alternative — the
 * one this replaces — was to fetch every footprint in the viewport and extrude
 * it at runtime, then step and parapet the tall ones, capped at 220 because
 * doing more was several seconds of main-thread tessellation on every viewport
 * change.
 *
 * 3-D Tiles moves all of that to build time. `scripts/build-3dtiles.ts` turns
 * the city's own CityGML into a quadtree of `.glb` nodes, each carrying a
 * *geometric error* — how wrong it is to stop there. `TilesRenderer` walks the
 * tree every frame with our camera and loads only the nodes whose error would
 * exceed a pixel budget on screen. Detail arrives where you are looking and
 * nowhere else, and a tile once fetched is cached by the browser under its own
 * URL forever.
 *
 * It is the format both Cesium's and Esri's New York demos use, and the
 * reasoning is theirs.
 *
 * ## Why `3d-tiles-renderer` and not deck.gl's `Tile3DLayer`
 *
 * deck.gl already ships a 3-D Tiles layer and it is already a dependency here,
 * which makes it the obvious choice and the wrong one. deck.gl's overlay is a
 * **separate canvas composited above** MapLibre's, so a tiled city drawn there
 * would paint over the towers, the bands and the streets three.js draws — the
 * same compositing fact that moved all of those into three.js in the first
 * place. `3d-tiles-renderer` renders into *our* scene, in our depth buffer,
 * with our camera. That is the whole difference and it decides it.
 *
 * ## The frame check
 *
 * A tileset's vertices are metres from a specific anchor. Loading one built at
 * a different anchor puts Manhattan a few hundred metres into the Hudson and
 * nothing about the frame would look wrong — every building would simply be in
 * the wrong place, consistently. So the build writes `frame.json` beside the
 * tileset and this refuses to draw when the two disagree.
 */

/** How wrong a tile may be, in pixels, before the renderer refines it. */
const ERROR_TARGET = 12;

/**
 * How much geometry may stay resident.
 *
 * `TilesRenderer` evicts least-recently-used tiles once the cache is over
 * `minSize` and refuses to grow past `maxSize`. Left unbounded, flying across
 * the borough accumulates the whole city in memory — which is the failure this
 * format exists to avoid, arrived at by a different route.
 *
 * Counted in tiles rather than bytes because our nodes are all roughly the
 * same size by construction: the tree splits on building count, not extent.
 */
const CACHE_MIN_TILES = 300;
const CACHE_MAX_TILES = 700;

export interface TilesHandle {
  group: THREE.Group;
  /** Call once per frame with the camera that is actually being drawn from. */
  update(camera: THREE.Camera, width: number, height: number, seconds: number): void;
  applyPreset(preset: AtmospherePreset, sunDir: [number, number, number]): void;
  /** What is currently resident, for the budget readout. */
  stats(): { visible: number; loaded: number; triangles: number };
  dispose(): void;
}

/**
 * Checks the tileset was built at the anchor this scene is using.
 *
 * Returns the tileset URL if it matches, null otherwise — and logs, because a
 * silently absent city is the kind of thing that gets diagnosed as a rendering
 * bug for an hour.
 */
export async function tilesetFor(
  baseUrl: string,
  anchor: [number, number],
): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/frame.json`, { cache: 'force-cache' });
    if (!res.ok) return null;
    const frame = (await res.json()) as { anchor?: [number, number] };
    if (!frame.anchor) return null;

    // A tenth of a degree is about 8 km; anything beyond a rounding error is a
    // different frame and must not be drawn.
    const drift =
      Math.abs(frame.anchor[0] - anchor[0]) + Math.abs(frame.anchor[1] - anchor[1]);
    if (drift > 1e-6) {
      console.warn(
        `[explore] 3-D Tiles anchored at ${frame.anchor}, scene at ${anchor}. ` +
          'Rebuild with scripts/build-3dtiles.ts. Falling back to extruded footprints.',
      );
      return null;
    }
    return `${baseUrl}/tileset.json`;
  } catch {
    // No tileset published. The extruded-footprint path is the fallback and is
    // a perfectly good map — see `useExplore`.
    return null;
  }
}

export function makeTiles(
  url: string,
  preset: AtmospherePreset,
  sunDir: [number, number, number],
): TilesHandle {
  const tiles = new TilesRenderer(url);

  tiles.errorTarget = ERROR_TARGET;
  tiles.lruCache.minSize = CACHE_MIN_TILES;
  tiles.lruCache.maxSize = CACHE_MAX_TILES;
  /**
   * Parents stay drawn while children load.
   *
   * The tileset is `ADD` refined, so a tall tower held at the root remains
   * while the low-rise around it streams in. Without this the skyline would
   * blink out and back every time the tree refined.
   */
  tiles.displayActiveTiles = false;

  /**
   * One facade material for the whole tileset, shared by every tile.
   *
   * The city's own survey gives shape and nothing else — no year, no material,
   * no fenestration — so this is the plain archetype, the same one the
   * extruded context city used. It is a single `ShaderMaterial` reused across
   * every tile, so the hour, the sun and the haze are one uniform update
   * rather than one per node.
   */
  const material = makeFacadeMaterial(preset, sunDir, {
    floorHeightM: 3.8,
    plain: true,
  });

  /**
   * Swap the tile's own material as it loads.
   *
   * The `.glb` carries an unlit white material by design — see `glb.ts`. What
   * a building looks like belongs to Explore's facade shader, and baking a
   * second opinion into the asset is how the two drift.
   *
   * The vertex attributes the shader wants (`along`, `up`, `wall`, `isWall`)
   * are not in the tileset, because they would triple its size for a city that
   * is scenery. `plain: true` is the archetype that does not use them, and the
   * defaults below keep the shader from reading undefined attributes.
   */
  tiles.addEventListener('load-model', (event: { scene?: THREE.Object3D }) => {
    event.scene?.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = material;
      mesh.renderOrder = -5;
      const geometry = mesh.geometry;
      if (!geometry.getAttribute('along')) {
        const n = geometry.getAttribute('position').count;
        for (const [name, fill] of [
          ['along', 0],
          ['up', 0],
          ['wall', 1],
          ['isWall', 0],
        ] as const) {
          geometry.setAttribute(
            name,
            new THREE.BufferAttribute(new Float32Array(n).fill(fill), 1),
          );
        }
      }
    });
  });

  const group = new THREE.Group();
  /**
   * glTF is Y-up and this scene is Z-up.
   *
   * The build already swapped the axes when writing the buffers, so the
   * geometry inside each `.glb` is in glTF's own convention. Rotating the
   * whole group back is one matrix rather than a per-vertex pass at load time.
   */
  group.rotation.x = Math.PI / 2;
  group.add(tiles.group);

  let triangles = 0;

  return {
    group,
    update(camera, width, height, seconds) {
      /**
       * The camera is re-registered every frame, on purpose.
       *
       * `ExploreLayer` does not own a camera in the usual sense: it assigns a
       * projection matrix directly and leaves the world matrix as identity,
       * and in free look it swaps in a matrix of its own. `TilesRenderer`
       * derives screen-space error from the camera's projection and resolution,
       * so it has to be told about both after they have been set for the
       * frame, not before.
       */
      tiles.setCamera(camera);
      tiles.setResolution(camera, width, height);
      tiles.update();
      updateFacadeUniforms(material, camera.position, seconds);
    },
    applyPreset(next, nextSun) {
      applyPreset(material, next, nextSun);
    },
    stats() {
      const group = tiles.group;
      triangles = 0;
      group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          triangles += (mesh.geometry.getIndex()?.count ?? 0) / 3;
        }
      });
      return {
        visible: tiles.visibleTiles?.size ?? 0,
        loaded: tiles.group.children.length,
        triangles,
      };
    },
    dispose() {
      tiles.dispose();
      material.dispose();
    },
  };
}
