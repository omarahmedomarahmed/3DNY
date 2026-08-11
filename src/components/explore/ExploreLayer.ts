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
import { cameraOffset, MAPLIBRE_FOV } from '@/lib/explore/camera';
import { sunDirection } from '@/lib/explore/sun';
import { interiorFor, makeInteriorGlassMaterial } from './materials';
import {
  applyPreset,
  makeFacadeMaterial,
  updateFacadeUniforms,
  type FacadeOptions,
} from './materials';
import type { MassingArrays } from '@/lib/explore/massing';
import { groundColor, makeGround, type GroundHandle } from './ground3d';
import { makeBandMaterial, type BandGroup } from './bands3d';
import { makeLife, updateLife, type LifeHandle } from './life3d';
import type { Agent } from '@/lib/explore/agents';
import { makeStreets, type StreetsHandle } from './streets3d';
import { applySkyPreset, makeSky, updateSky, type SkyHandle } from './sky3d';
import { applyWaterPreset, makeWater, type WaterHandle } from './water3d';
import { makeFurniture, type FurnitureHandle } from './furniture3d';
import type { StreetscapeResult } from '@/lib/streetscape';
import type { Inside } from '@/lib/explore/walk';
import { freeForward, type FreeCam } from '@/lib/explore/freecam';

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
  /** True when the silhouette came from NYC's surveyed model, not a guess. */
  surveyed?: boolean;
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
  private streets: StreetsHandle | null = null;
  private sky: SkyHandle | null = null;
  private water: WaterHandle | null = null;
  private freeCam: FreeCam | null = null;
  private life: LifeHandle | null = null;
  private carAgents: Agent[] = [];
  private peopleAgents: Agent[] = [];
  private lastFrameAt = 0;
  private plateMesh: THREE.Mesh | null = null;
  private plateMaterial: THREE.MeshBasicMaterial | null = null;
  private insideBuildingId: string | null = null;
  /** The host building's own facade, held while it is standing in as glass. */
  private hostMaterial: THREE.Material | null = null;
  private interiorGlass: THREE.ShaderMaterial | null = null;
  private furniture: FurnitureHandle | null = null;
  private contextMesh: THREE.Mesh | null = null;
  private contextMaterial: THREE.ShaderMaterial | null = null;
  private contextTriangles = 0;
  private readonly bandMeshes = new Map<string, THREE.Mesh>();
  private readonly bandMaterials: THREE.MeshBasicMaterial[] = [];
  private started = Date.now();
  /** False until `render` has run once and the projection matrix is real. */
  private projected = false;

  /** Triangle count of everything currently in the scene. */
  triangles = 0;
  /** Triangle count of the availability bands alone. */
  bandTriangles = 0;
  /** How many buildings are drawn from the city's surveyed model. */
  surveyedCount = 0;

  constructor(anchor: [number, number], preset: AtmospherePreset) {
    this.frame = makeFrame(anchor[0], anchor[1]);
    this.originMercator = maplibregl.MercatorCoordinate.fromLngLat(
      { lng: anchor[0], lat: anchor[1] },
      0,
    );
    this.metersToMercator = this.originMercator.meterInMercatorCoordinateUnits();
    this.preset = preset;
    this.sunDir = sunDirection(preset.timestamp, anchor[0], anchor[1]);
    this.ground = makeGround(preset);
    this.scene.add(this.ground.mesh);

    /**
     * Our own sky, rather than MapLibre's.
     *
     * MapLibre's sits behind everything three.js draws, so the ground plane
     * hides most of it; it has no sun in it, only a gradient the sun tints;
     * and it stops existing when a basemap style fails to load, which is a
     * normal state on a corporate network and the one a demo is most likely
     * to be given.
     */
    this.sky = makeSky(preset, this.sunDir);
    this.scene.add(this.sky.mesh);

    /**
     * There are no `THREE.Light` objects in this scene, deliberately.
     *
     * Every surface here — facades, roofs, bands, ground, streets, cars,
     * people — is lit explicitly from the atmosphere preset, by the same sun
     * position the flat map uses. An earlier version added a hemisphere and a
     * directional light for the traffic's stock Lambert material and every car
     * rendered black: this camera has its projection matrix assigned directly
     * and its world matrix left as identity, and three.js's lighting is built
     * for a camera it controls.
     *
     * Shading by hand is also what keeps the two modes agreeing about how
     * bright a Goldenrod band looks, which is the only comparison that
     * matters.
     */
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
    if (this.plateMesh) {
      this.scene.remove(this.plateMesh);
      this.plateMesh.geometry.dispose();
      this.plateMesh = null;
    }
    this.plateMaterial?.dispose();
    if (this.furniture) {
      this.scene.remove(this.furniture.group);
      this.furniture.dispose();
      this.furniture = null;
    }
    this.interiorGlass?.dispose();
    this.interiorGlass = null;
    this.hostMaterial = null;
    this.plateMaterial = null;
    if (this.sky) {
      this.scene.remove(this.sky.mesh);
      this.sky.dispose();
      this.sky = null;
    }
    if (this.streets) {
      this.scene.remove(this.streets.group);
      this.streets.dispose();
      this.streets = null;
    }
    if (this.water) {
      this.scene.remove(this.water.mesh);
      this.water.dispose();
      this.water = null;
    }
    if (this.life) {
      this.scene.remove(this.life.cars);
      this.scene.remove(this.life.people);
      this.life.dispose();
      this.life = null;
    }
    this.carAgents = [];
    this.peopleAgents = [];
    if (this.contextMesh) {
      this.scene.remove(this.contextMesh);
      this.contextMesh.geometry.dispose();
      this.contextMesh = null;
    }
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
        // Derived from the id rather than drawn at random, so a building's
        // lit windows are the same ones every time the page is opened.
        seed: seedOf(spec.id),
        interior: interiorFor(this.preset),
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
    this.surveyedCount = specs.filter((s) => s.surveyed).length;
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

  /**
   * The surrounding city: forty thousand footprints, one mesh, one draw call.
   *
   * Merged rather than one mesh each, because at this count the draw-call
   * budget is the binding constraint long before the triangle budget is —
   * forty thousand meshes is forty thousand state changes a frame, and the
   * 1,000-call budget in §9 is gone at building 1,001.
   *
   * It gets the same facade shader with fenestration switched off. Scenery
   * should read as built without acquiring enough detail to compete with the
   * towers that carry data, and a window grid on the whole city is exactly the
   * kind of texture that would.
   */
  setContext(arrays: MassingArrays | null): void {
    if (this.contextMesh) {
      this.scene.remove(this.contextMesh);
      this.contextMesh.geometry.dispose();
      this.contextMesh = null;
    }
    this.contextTriangles = 0;
    if (!arrays || arrays.triangles === 0) {
      this.map?.triggerRepaint();
      return;
    }

    if (!this.contextMaterial) {
      this.contextMaterial = makeFacadeMaterial(this.preset, this.sunDir, {
        // The context city has no per-building floor count, so the storey
        // rhythm is Manhattan's typical 3.8 m rather than a guess per tower.
        floorHeightM: 3.8,
        plain: true,
      });
      this.materials.push(this.contextMaterial);
    }

    const mesh = new THREE.Mesh(toGeometry(arrays), this.contextMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder = -5;
    this.scene.add(mesh);
    this.contextMesh = mesh;
    this.contextTriangles = arrays.triangles;
    this.map?.triggerRepaint();
  }

  /**
   * The one walkable floor plate: a slab, a ceiling, and the walls made
   * two-sided so they can be seen from within.
   *
   * Passing null takes it all away again, including the two-sidedness. The
   * default is FrontSide because a closed shell never needs its inside drawn
   * and drawing it doubles the fragment cost of the entire city; that trade is
   * only worth reversing for the one building you are standing in.
   */
  setFloorPlate(
    buildingId: string | null,
    arrays: MassingArrays | null,
    /** The plate itself, for the fit-out. Null leaves the floor bare. */
    inside: Inside | null = null,
  ): void {
    if (this.furniture) {
      this.scene.remove(this.furniture.group);
      this.furniture.dispose();
      this.furniture = null;
    }
    if (this.plateMesh) {
      this.scene.remove(this.plateMesh);
      this.plateMesh.geometry.dispose();
      this.plateMesh = null;
    }
    /**
     * Put the previous host's own facade back.
     *
     * Restoring by remembered reference rather than by rebuilding: the facade
     * material carries the building's seed, its stone, its year and its
     * fenestration, and a rebuilt one would be a *different* building for the
     * rest of the session.
     */
    if (this.insideBuildingId) {
      const previous = this.meshes.get(this.insideBuildingId);
      const original = this.hostMaterial;
      if (previous && original) {
        previous.material = original;
        previous.renderOrder = 0;
      } else if (previous) {
        (previous.material as THREE.Material).side = THREE.FrontSide;
      }
    }
    this.hostMaterial = null;
    this.insideBuildingId = buildingId;

    if (!buildingId || !arrays || arrays.triangles === 0) {
      this.map?.triggerRepaint();
      return;
    }

    /**
     * The containing building becomes glass, from the inside.
     *
     * Turning the facade double-sided — which is what this did first — leaves
     * an opaque curtain wall between you and the view, so standing on the 23rd
     * floor showed you a grey box. From a tenant's side a curtain wall is
     * nearly all glass; what you see is the mullion grid and the city through
     * it. See `makeInteriorGlassMaterial`.
     */
    const host = this.meshes.get(buildingId);
    if (host) {
      this.hostMaterial = host.material as THREE.Material;
      const storey =
        (arrays as MassingArrays & { floorHeightM?: number }).floorHeightM ?? 3.8;
      this.interiorGlass?.dispose();
      this.interiorGlass = makeInteriorGlassMaterial(this.preset, storey);
      host.material = this.interiorGlass;
      // Transparent, so it draws after the opaque city it is looking at.
      host.renderOrder = 12;
    }

    if (!this.plateMaterial) {
      this.plateMaterial = new THREE.MeshBasicMaterial({
        // A pale unlit slab. There is no sun inside a building and no
        // pretence of one: the interior is a datum to stand on and look out
        // from, not a room this map claims to know anything about.
        color: new THREE.Color(0.80, 0.80, 0.81),
        side: THREE.DoubleSide,
      });
    }

    const mesh = new THREE.Mesh(toGeometry(arrays), this.plateMaterial);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.plateMesh = mesh;

    /**
     * The fit-out, which is a ruler rather than a floor plan.
     *
     * A bare plate gives the eye nothing whose size it knows, so a 4,000 SF
     * floor and a 40,000 SF floor look identical from inside — see
     * `furniture3d.ts` for why that is the one thing this mode cannot afford.
     */
    if (inside) {
      this.furniture = makeFurniture(inside, this.preset);
      if (this.furniture) this.scene.add(this.furniture.group);
    }

    this.map?.triggerRepaint();
  }

  /**
   * The cars and the people.
   *
   * Passing empty lists takes the meshes down to a count of zero rather than
   * removing them, so switching the surrounding city off and on again does not
   * churn two instanced buffers. Passing them at all starts the animation
   * loop, which is the one thing in this scene that repaints continuously.
   */
  setAgents(cars: Agent[], people: Agent[]): void {
    if (!this.life) {
      this.life = makeLife(this.preset);
      this.scene.add(this.life.cars);
      this.scene.add(this.life.people);
    }
    this.carAgents = cars;
    this.peopleAgents = people;
    this.map?.triggerRepaint();
  }

  /**
   * The roadbed, the pavements and the rivers.
   *
   * All three come out of the same streetscape payload the flat map already
   * fetches, so water arrives here rather than through a second call: a scene
   * with streets but no river is a state nothing wants and one more thing that
   * could be left half-wired.
   */
  setStreets(streetscape: StreetscapeResult | null): void {
    if (this.streets) {
      this.scene.remove(this.streets.group);
      this.streets.dispose();
      this.streets = null;
    }
    if (this.water) {
      this.scene.remove(this.water.mesh);
      this.water.dispose();
      this.water = null;
    }
    if (streetscape) {
      this.streets = makeStreets(this.frame, streetscape, this.preset);
      if (this.streets) {
        this.scene.add(this.streets.group);
      }
      this.water = makeWater(this.frame, streetscape, this.preset, this.sunDir);
      if (this.water) this.scene.add(this.water.mesh);
    }
    this.map?.triggerRepaint();
  }

  /**
   * Hands the projection to a camera of our own, or gives it back to MapLibre.
   *
   * `null` is the normal state and is what every existing view uses. A non-null
   * camera means the next frame is drawn from that eye instead, at any pitch
   * including straight up.
   */
  setFreeCamera(cam: FreeCam | null): void {
    this.freeCam = cam;
    this.map?.triggerRepaint();
  }

  /** True while anything in the scene is moving. */
  get animating(): boolean {
    return this.carAgents.length > 0 || this.peopleAgents.length > 0;
  }

  setPreset(preset: AtmospherePreset): void {
    this.preset = preset;
    this.sunDir = sunDirection(preset.timestamp, this.frame.lon0, this.frame.lat0);
    for (const m of this.materials) applyPreset(m, preset, this.sunDir);
    if (this.sky) applySkyPreset(this.sky, preset, this.sunDir);
    if (this.water) applyWaterPreset(this.water, preset, this.sunDir);
    if (this.ground) {
      (this.ground.material.uniforms.uHazeColor.value as THREE.Color).setRGB(
        preset.haze[0] / 255,
        preset.haze[1] / 255,
        preset.haze[2] / 255,
      );
      this.ground.material.uniforms.uHazeStrength.value = preset.hazeStrength;
      (this.ground.material.uniforms.uGroundColor.value as THREE.Color).copy(
        groundColor(preset),
      );
      (this.ground.material.uniforms.uHorizonColor.value as THREE.Color).set(preset.horizon);
    }
    this.map?.triggerRepaint();
  }

  /** Meshes currently in the scene, for raycasting and for tests. */
  get objects(): THREE.Mesh[] {
    return [...this.meshes.values()];
  }

  /**
   * What is under a pixel, answered by three.js rather than by deck.gl.
   *
   * deck.gl owns picking everywhere else in this product and that is right:
   * it is exact, it runs in its own framebuffer, and every popup and fly-to in
   * both modes goes through it. It cannot answer here, because during free
   * look deck.gl is projecting with MapLibre's camera and this frame was not
   * drawn from it — its answer would be the building several blocks from the
   * one under the cursor.
   *
   * So free look raycasts the meshes it drew itself. That is a second picking
   * path, which is a cost worth naming: it can only see the massing three.js
   * holds, so it returns a building and an elevation, and the caller resolves
   * the elevation to a floor and a space. It is never used while deck.gl's
   * picking is available, so the two cannot disagree in the same frame.
   */
  pickAt(px: number, py: number): { buildingId: string; z: number } | null {
    const map = this.map;
    if (!map || !this.freeCam) return null;
    const canvas = map.getCanvas();
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;

    const aspect = w / h;
    const [fx, fy, fz] = freeForward(this.freeCam);
    const forward = new THREE.Vector3(fx, fy, fz);
    const right = new THREE.Vector3().crossVectors(forward, PICK_UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();

    // Normalised device coordinates, then the frustum's half-extents at unit
    // distance. The same field of view the projection uses, so a ray built
    // here lands on the pixel it was asked about.
    const ndcX = (px / w) * 2 - 1;
    const ndcY = 1 - (py / h) * 2;
    const tanHalf = Math.tan(MAPLIBRE_FOV / 2);

    const dir = forward
      .clone()
      .addScaledVector(right, ndcX * tanHalf * aspect)
      .addScaledVector(up, ndcY * tanHalf)
      .normalize();

    PICK_RAY.set(
      new THREE.Vector3(this.freeCam.x, this.freeCam.y, this.freeCam.z),
      dir,
    );
    PICK_RAY.far = 20_000;

    let best: { buildingId: string; z: number; distance: number } | null = null;
    for (const [id, mesh] of this.meshes) {
      /**
       * The building you are standing in is not a thing you can click.
       *
       * Its facade is glass while you are inside it and the ray starts within
       * it, so every click would hit the pane six inches from the camera and
       * resolve to the space you are already in. Skipping it is what makes
       * "click the tower across the street to move into it" work at all.
       */
      if (id === this.insideBuildingId) continue;
      const hits = PICK_RAY.intersectObject(mesh, false);
      if (hits.length === 0) continue;
      const hit = hits[0];
      if (!best || hit.distance < best.distance) {
        best = { buildingId: id, z: hit.point.z, distance: hit.distance };
      }
    }
    return best ? { buildingId: best.buildingId, z: best.z } : null;
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
    const canvas = map.getCanvas();

    if (this.freeCam) {
      /**
       * The free camera bypasses Mercator entirely.
       *
       * There is no `local` matrix here and there does not need to be: the
       * scene is already in metres, so a perspective projection times the
       * inverse of the camera's own transform is the whole pipeline. Which is
       * also why this camera can do what MapLibre's cannot — it is not a map
       * camera with a tilt limit, it is a camera.
       */
      this.camera.projectionMatrix = freeProjection(
        this.freeCam,
        (canvas.clientWidth || 1200) / (canvas.clientHeight || 800),
      );
      this.cameraPos.set(this.freeCam.x, this.freeCam.y, this.freeCam.z);
    } else {
      const s = this.metersToMercator;
      const local = new THREE.Matrix4()
        .makeTranslation(this.originMercator.x, this.originMercator.y, this.originMercator.z)
        .scale(new THREE.Vector3(s, -s, s));

      this.camera.projectionMatrix = new THREE.Matrix4()
        .fromArray(matrix as number[])
        .multiply(local);

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
        height: canvas.clientHeight || 800,
      });
      this.cameraPos.set(cx + offset.east, cy + offset.north, offset.altitude);
    }
    this.projected = true;

    const now = Date.now();
    const seconds = (now - this.started) / 1000;
    for (const m of this.materials) updateFacadeUniforms(m, this.cameraPos, seconds);

    if (this.life && this.animating) {
      const dt = this.lastFrameAt > 0 ? (now - this.lastFrameAt) / 1000 : 0;
      updateLife(this.life, this.carAgents, this.peopleAgents, dt);
      // Keeps the frames coming. MapLibre only redraws on demand, so without
      // this the traffic advances one step and then stops — which looks far
      // more broken than no traffic at all.
      map.triggerRepaint();
    }
    this.lastFrameAt = now;
    if (this.ground) {
      (this.ground.material.uniforms.uCameraPos.value as THREE.Vector3).copy(this.cameraPos);
    }
    if (this.water) {
      const u = this.water.material.uniforms;
      (u.uCameraPos.value as THREE.Vector3).copy(this.cameraPos);
      u.uTime.value = seconds;
    }
    if (this.sky) {
      updateSky(this.sky, this.cameraPos, seconds);
      // Clouds drift, so the frame after this one is different from this one.
      map.triggerRepaint();
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

  /**
   * A point in the scene, as a pixel on the screen.
   *
   * This exists for verification. The plan's sprint 2 kill criterion is that
   * bands and facades must not disagree about where a floor is, and the only
   * honest way to check that is to ask where the 14th floor lands on screen
   * and then look at those pixels. Reading the source cannot prove it and a
   * unit test cannot either — both would be checking the same arithmetic
   * twice.
   *
   * Returns null before the first frame, when there is no projection yet.
   */
  projectToScreen(x: number, y: number, z: number): { x: number; y: number } | null {
    const map = this.map;
    if (!map || !this.projected) return null;
    /**
     * The `w` check is not defensive, it is the whole correctness of this.
     *
     * A point behind the camera comes back with a negative w, and dividing by
     * it mirrors the result into a perfectly plausible on-screen coordinate.
     * The harness then probed a pixel that has nothing to do with the point it
     * asked about and reported a band missing from a floor that was simply
     * above the top of the frame. `Vector3.applyMatrix4` performs that divide
     * silently, so the sign has to be read from a Vector4 before it is lost.
     */
    const v = new THREE.Vector4(x, y, z, 1).applyMatrix4(this.camera.projectionMatrix);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || v.w <= 0) return null;
    v.x /= v.w;
    v.y /= v.w;
    const canvas = map.getCanvas();
    return {
      x: ((v.x + 1) / 2) * canvas.clientWidth,
      y: ((1 - v.y) / 2) * canvas.clientHeight,
    };
  }

  /**
   * A point on the building's own wall, at a height, nearest the camera.
   *
   * For verification. The harness has to probe the pixels where a band should
   * be, and it cannot use the band's geometry to find them — that would be the
   * test asking the code where it drew and then agreeing. This reads the
   * MASSING instead, which is a separate code path: the surveyed surfaces or
   * the extrusion, never the band builder.
   *
   * A wall in this scene is vertical, so any vertex of a wall that spans the
   * requested height carries the right horizontal position.
   */
  nearWallPointAt(
    buildingId: string,
    zM: number,
  ): { x: number; y: number; z: number; zMin: number; zMax: number } | null {
    const mesh = this.meshes.get(buildingId);
    if (!mesh) return null;
    const g = mesh.geometry;
    const position = g.getAttribute('position');
    const isWall = g.getAttribute('isWall');
    const index = g.getIndex();
    if (!position || !isWall || !index) return null;

    let best: { x: number; y: number; zMin: number; zMax: number } | null = null;
    let bestDistance = Infinity;

    // Walk triangles rather than vertices, so a wall's z-span is known.
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      if (isWall.getX(a) < 0.5) continue;
      const b = index.getX(t + 1);
      const c = index.getX(t + 2);

      const zs = [position.getZ(a), position.getZ(b), position.getZ(c)];
      const zMin = Math.min(...zs);
      const zMax = Math.max(...zs);
      if (zM < zMin - 0.01 || zM > zMax + 0.01) continue;

      for (const v of [a, b, c]) {
        const x = position.getX(v);
        const y = position.getY(v);
        const d = Math.hypot(x - this.cameraPos.x, y - this.cameraPos.y);
        if (d < bestDistance) {
          bestDistance = d;
          /**
           * The wall's own z-span comes back with it.
           *
           * A probe that asks for a different wall at every height is not
           * measuring one facade, it is measuring whichever piece of the
           * building happens to span that height — and on a surveyed massing
           * with wings, setbacks and annexes those are in wildly different
           * places. The caller needs to know which heights this column can
           * actually answer for.
           */
          best = { x, y, zMin, zMax };
        }
      }
    }

    return best ? { ...best, z: zM } : null;
  }

  /** What the last frame cost, for the budget in §9 of the plan. */
  get budget(): {
    triangles: number;
    bandTriangles: number;
    drawCalls: number;
    surveyed: number;
    buildings: number;
    streetTriangles: number;
    waterTriangles: number;
    furnitureTriangles: number;
    desks: number;
    contextTriangles: number;
    cars: number;
    people: number;
  } {
    return {
      triangles:
        this.triangles + this.bandTriangles + this.contextTriangles +
        (this.streets?.triangles ?? 0) + (this.water?.triangles ?? 0) +
        (this.furniture?.triangles ?? 0),
      waterTriangles: this.water?.triangles ?? 0,
      furnitureTriangles: this.furniture?.triangles ?? 0,
      desks: this.furniture?.desks ?? 0,
      bandTriangles: this.bandTriangles,
      drawCalls: this.renderer?.info.render.calls ?? 0,
      surveyed: this.surveyedCount,
      buildings: this.meshes.size,
      streetTriangles: this.streets?.triangles ?? 0,
      contextTriangles: this.contextTriangles,
      cars: this.life ? this.life.cars.count : 0,
      people: this.life ? this.life.people.count : 0,
    };
  }
}

/** A small stable number from a string. Same building, same windows. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
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

/** Reused across picks. */
const PICK_RAY = new THREE.Raycaster();
const PICK_UP = new THREE.Vector3(0, 0, 1);

/** Reused across frames: the free camera runs at sixty of them a second. */
const FREE_EYE = new THREE.Vector3();
const FREE_TARGET = new THREE.Vector3();
const FREE_UP = new THREE.Vector3(0, 0, 1);
const FREE_VIEW = new THREE.Matrix4();
const FREE_PERSPECTIVE = new THREE.Matrix4();

/**
 * Projection × view for the free camera, in scene metres.
 *
 * The field of view is MapLibre's own, so switching the free camera on and off
 * does not change how wide the world looks — only where the eye is and where it
 * is pointed. `far` is 60 km, past the sky dome's 40 km radius; `near` is 0.1 m,
 * because the camera is allowed right up against a facade.
 *
 * The result is assigned straight to `camera.projectionMatrix` with the
 * camera's world matrix left as identity, which is the same trick the MapLibre
 * path uses — three.js multiplies by `matrixWorldInverse` and identity is the
 * one value that leaves a hand-built matrix alone.
 */
function freeProjection(cam: FreeCam, aspect: number): THREE.Matrix4 {
  const [fx, fy, fz] = freeForward(cam);
  FREE_EYE.set(cam.x, cam.y, cam.z);
  FREE_TARGET.set(cam.x + fx, cam.y + fy, cam.z + fz);

  FREE_VIEW.lookAt(FREE_EYE, FREE_TARGET, FREE_UP);
  FREE_VIEW.setPosition(FREE_EYE);
  FREE_VIEW.invert();

  FREE_PERSPECTIVE.makePerspective(
    ...perspectiveExtents((MAPLIBRE_FOV * 180) / Math.PI, aspect, 0.1, 60_000),
  );
  return FREE_PERSPECTIVE.clone().multiply(FREE_VIEW);
}

/**
 * `makePerspective` takes frustum edges, not a field of view.
 *
 * three.js's own `PerspectiveCamera` does this conversion internally and is not
 * used here because it would also want to own the projection matrix this layer
 * assigns by hand. Six numbers is cheaper than fighting it.
 */
function perspectiveExtents(
  fovDeg: number,
  aspect: number,
  near: number,
  far: number,
): [number, number, number, number, number, number] {
  const top = near * Math.tan((fovDeg * Math.PI) / 360);
  const height = 2 * top;
  const width = aspect * height;
  const left = -0.5 * width;
  return [left, left + width, top, top - height, near, far];
}
