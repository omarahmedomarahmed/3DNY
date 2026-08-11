import * as THREE from 'three';
import maplibregl from 'maplibre-gl';

/**
 * three.js colour management is OFF, deliberately and globally for this mode.
 *
 * Since r152 three.js treats `new Color('#8FB4E4')` as an sRGB value and
 * converts it into a linear working space, while `new Color(0.9, 0.9, 0.9)`
 * is taken at face value. Explore mode mixes both — sky colours come from the
 * atmosphere presets as hex, stone comes from numbers — so with management on,
 * half the palette was silently a stop and a half darker than the other half.
 * The city came out slate blue and it took a screenshot to see it, because
 * every individual number in the shader was correct.
 *
 * Management staying off is also the right answer rather than merely the
 * convenient one: this renderer writes into MapLibre's own drawing buffer and
 * composites under deck.gl, and both of those write display-referred values
 * with no encode step. Explore mode has to live in their colour space, not in
 * its own.
 */
THREE.ColorManagement.enabled = false;
import type { AtmospherePreset } from '../map/atmosphere';
import { makeFrame, toLocal, type LocalFrame } from '@/lib/explore/frame';
import { cameraOffset } from '@/lib/explore/camera';
import { sunDirection } from '@/lib/explore/sun';
import {
  applyPreset,
  makeFacadeMaterial,
  updateFacadeUniforms,
  type FacadeOptions,
} from './materials';
import type { MassingArrays } from '@/lib/explore/massing';
import { makeGround, type GroundHandle } from './ground3d';
import { makeBandMaterial, type BandGroup } from './bands3d';

/**
 * three.js inside MapLibre's own WebGL context.
 *
 * MapLibre's custom-layer hook hands over the live GL context and the
 * projection matrix for the frame it is part-way through drawing. three.js
 * renders into that same context with that same camera, which is the reason
 * this approach was chosen over a second stacked canvas: there is one depth
 * buffer and one projection, so a facade and the basemap under it cannot
 * disagree about where anything is.
 *
 * Three things about this are easy to get wrong and expensive to debug:
 *
 * 1. **`autoClear` must be off.** three.js clears by default, and clearing
 *    here wipes the basemap MapLibre has already drawn this frame. The symptom
 *    is a black map with correct buildings on it.
 * 2. **`resetState()` before every render.** three.js caches GL state to avoid
 *    redundant calls. MapLibre has been changing that state behind its back
 *    all frame, so the cache is a pack of lies by the time we are called.
 * 3. **The scene is metres, not Mercator.** See `frame.ts`. The matrix that
 *    bridges the two is built once, here, and nothing downstream sees Mercator
 *    at all.
 *
 * deck.gl is untouched and still draws on its own canvas above this one. That
 * is deliberate and it is what keeps the availability bands, the picking, the
 * popups and the colour overrides working exactly as they do on the flat map.
 * The trade it makes is stated in the decision log: a band is never occluded
 * by the tower in front of it. On this product that is the right way round.
 */

export interface ExploreBuildingSpec {
  id: string;
  /** Scene-space geometry, already in metres relative to the layer frame. */
  arrays: MassingArrays;
  /** Metres. Drives the window grid's vertical rhythm. */
  floorHeightM: number;
  yearBuilt: number | null;
  /** Context massing gets no fenestration and no glass. */
  plain?: boolean;
}

export class ExploreLayer implements maplibregl.CustomLayerInterface {
  readonly id = 'explore-3d';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private map: maplibregl.Map | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly frame: LocalFrame;
  /** Mercator origin and scale for the frame, computed once. */
  private readonly originMercator: maplibregl.MercatorCoordinate;
  private readonly metersToMercator: number;

  private preset: AtmospherePreset;
  private sunDir: [number, number, number];
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly cameraPos = new THREE.Vector3();
  private ground: GroundHandle | null = null;
  private readonly bandMeshes = new Map<string, THREE.Mesh>();
  private readonly bandMaterials: THREE.MeshBasicMaterial[] = [];
  private theme: 'dark' | 'light';
  private started = Date.now();

  /** Triangle count of everything currently in the scene. */
  triangles = 0;
  /** Triangle count of the availability bands alone. */
  bandTriangles = 0;

  constructor(anchor: [number, number], preset: AtmospherePreset, theme: 'dark' | 'light' = 'light') {
    this.theme = theme;
    this.frame = makeFrame(anchor[0], anchor[1]);
    this.originMercator = maplibregl.MercatorCoordinate.fromLngLat(
      { lng: anchor[0], lat: anchor[1] },
      0,
    );
    this.metersToMercator = this.originMercator.meterInMercatorCoordinateUnits();
    this.preset = preset;
    this.sunDir = sunDirection(preset.timestamp, anchor[0], anchor[1]);
    this.ground = makeGround(preset, theme);
    this.scene.add(this.ground.mesh);
  }

  get localFrame(): LocalFrame {
    return this.frame;
  }

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext | WebGLRenderingContext): void {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGLRenderingContext,
      antialias: true,
    });
    // Clearing here would erase the basemap MapLibre has already drawn.
    this.renderer.autoClear = false;
    this.renderer.autoClearDepth = false;
    // The shaders here output colours already in the space MapLibre composites
    // in; letting three.js apply its own tone mapping and sRGB conversion on
    // top would make Explore mode a different colour from the flat map, which
    // would put the two out of step on the one thing that has to match — how
    // loud a Goldenrod band looks.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
  }

  onRemove(): void {
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      this.scene.remove(mesh);
    }
    this.meshes.clear();
    for (const m of this.materials) m.dispose();
    this.materials.length = 0;
    for (const [, mesh] of this.bandMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.bandMeshes.clear();
    for (const m of this.bandMaterials) m.dispose();
    this.bandMaterials.length = 0;
    if (this.ground) {
      this.scene.remove(this.ground.mesh);
      this.ground.mesh.geometry.dispose();
      this.ground.material.dispose();
      this.ground = null;
    }
    // The renderer must NOT dispose the context: it belongs to MapLibre, and
    // Explore mode is a toggle, not a page.
    this.renderer = null;
    this.map = null;
  }

  /** Scene metres for a WGS84 point, in this layer's frame. */
  toScene(lon: number, lat: number): [number, number] {
    return toLocal(this.frame, lon, lat);
  }

  setBuildings(specs: ExploreBuildingSpec[]): void {
    const wanted = new Set(specs.map((s) => s.id));
    for (const [id, mesh] of this.meshes) {
      if (wanted.has(id)) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this.meshes.delete(id);
    }

    for (const spec of specs) {
      const existing = this.meshes.get(spec.id);
      if (existing) {
        existing.geometry.dispose();
        existing.geometry = toGeometry(spec.arrays);
        continue;
      }

      const options: FacadeOptions = {
        floorHeightM: spec.floorHeightM,
        yearBuilt: spec.yearBuilt,
        plain: spec.plain,
      };
      const material = makeFacadeMaterial(this.preset, this.sunDir, options);
      this.materials.push(material);

      const mesh = new THREE.Mesh(toGeometry(spec.arrays), material);
      // The scene is metres in a plane; there is nothing for three.js's own
      // frustum culling to do that the projection does not already do, and its
      // bounding-sphere pass on a hundred meshes is not free.
      mesh.frustumCulled = false;
      mesh.name = spec.id;
      this.scene.add(mesh);
      this.meshes.set(spec.id, mesh);
    }

    this.triangles = specs.reduce((n, s) => n + s.arrays.triangles, 0);
    this.map?.triggerRepaint();
  }

  /**
   * Replaces every availability band in the scene.
   *
   * Wholesale rather than incremental: bands are a few hundred triangles in
   * total and they change together whenever a filter, a colour or the
   * selection moves. Diffing them would be more code than the geometry costs.
   */
  setBands(groups: BandGroup[]): void {
    const wanted = new Set(groups.map((g) => g.key));
    for (const [key, mesh] of this.bandMeshes) {
      if (wanted.has(key)) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this.bandMeshes.delete(key);
    }

    for (const group of groups) {
      const existing = this.bandMeshes.get(group.key);
      if (existing) {
        existing.geometry.dispose();
        existing.geometry = toGeometry(group.arrays);
        (existing.material as THREE.MeshBasicMaterial).color.copy(group.color);
        continue;
      }
      const material = makeBandMaterial(group.color);
      this.bandMaterials.push(material);
      const mesh = new THREE.Mesh(toGeometry(group.arrays), material);
      mesh.frustumCulled = false;
      // Drawn after the city, so where a band and a wall land on the same
      // pixel at the same depth the band is the one that survives.
      mesh.renderOrder = 10;
      this.scene.add(mesh);
      this.bandMeshes.set(group.key, mesh);
    }

    this.bandTriangles = groups.reduce((n, g) => n + g.arrays.triangles, 0);
    this.map?.triggerRepaint();
  }

  setPreset(preset: AtmospherePreset): void {
    this.preset = preset;
    this.sunDir = sunDirection(preset.timestamp, this.frame.lon0, this.frame.lat0);
    for (const m of this.materials) applyPreset(m, preset, this.sunDir);
    if (this.ground) {
      (this.ground.material.uniforms.uHazeColor.value as THREE.Color).setRGB(
        preset.haze[0] / 255,
        preset.haze[1] / 255,
        preset.haze[2] / 255,
      );
      this.ground.material.uniforms.uHazeStrength.value = preset.hazeStrength;
    }
    this.map?.triggerRepaint();
  }

  /** Meshes currently in the scene, for raycasting and for tests. */
  get objects(): THREE.Mesh[] {
    return [...this.meshes.values()];
  }

  // MapLibre types the matrix as gl-matrix's `mat4`, which is an indexed
  // collection rather than an array. `fromArray` only needs indexing.
  render(
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    matrix: ArrayLike<number>,
  ): void {
    const renderer = this.renderer;
    const map = this.map;
    if (!renderer || !map) return;

    /**
     * Scene metres → Mercator → clip space, in one multiply.
     *
     * The Y scale is negative because Mercator's Y runs south and the scene's
     * runs north. Getting that sign wrong mirrors the entire city about the
     * anchor, which looks like every building being in the wrong place rather
     * than like a flipped axis — it cost an hour the first time.
     */
    const s = this.metersToMercator;
    const local = new THREE.Matrix4()
      .makeTranslation(this.originMercator.x, this.originMercator.y, this.originMercator.z)
      .scale(new THREE.Vector3(s, -s, s));

    this.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix as number[]).multiply(local);

    // Where the eye is, in scene metres. Reflections and haze both need it.
    // Derived from public accessors rather than read off `map.transform`,
    // which is an internal that has changed shape between versions — see
    // `lib/explore/camera.ts`.
    const centre = map.getCenter();
    const [cx, cy] = toLocal(this.frame, centre.lng, centre.lat);
    const offset = cameraOffset({
      center: [centre.lng, centre.lat],
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      height: map.getCanvas().clientHeight || 800,
    });
    this.cameraPos.set(cx + offset.east, cy + offset.north, offset.altitude);

    const seconds = (Date.now() - this.started) / 1000;
    for (const m of this.materials) updateFacadeUniforms(m, this.cameraPos, seconds);
    if (this.ground) {
      (this.ground.material.uniforms.uCameraPos.value as THREE.Vector3).copy(this.cameraPos);
    }

    // three.js has been caching GL state that MapLibre has been changing all
    // frame. Without this the first draw uses whatever program, buffer and
    // blend mode MapLibre left bound, and the result is anything from nothing
    // on screen to the basemap drawn in building colours.
    renderer.resetState();
    renderer.render(this.scene, this.camera);
  }

  /** The eye position in scene metres, as of the last frame drawn. */
  get eye(): THREE.Vector3 {
    return this.cameraPos;
  }
}

function toGeometry(a: MassingArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('along', new THREE.BufferAttribute(a.along, 1));
  g.setAttribute('up', new THREE.BufferAttribute(a.up, 1));
  g.setAttribute('wall', new THREE.BufferAttribute(a.wall, 1));
  g.setAttribute('isWall', new THREE.BufferAttribute(a.isWall, 1));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  return g;
}
