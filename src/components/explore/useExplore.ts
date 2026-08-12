'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { ExploreLayer, type ExploreBuildingSpec } from './ExploreLayer';
import type { AtmospherePreset } from '../map/atmosphere';
import { ringToLocal, toCCW } from '@/lib/explore/frame';
import {
  extrudedMassing,
  fallbackSteps,
  insetRingLocal,
  mergeMassings,
  steppedMassing,
  type MassingArrays,
} from '@/lib/explore/massing';
import { detailedBuildings } from '@/lib/explore/eligibility';
import { loadLod2, lod2For } from '@/lib/explore/lod2-registry';
import { massingToArrays } from '@/lib/explore/lod2';
import { parapetMassing, roofMassing, roofscapeFor } from './roofs3d';
import { buildingHeightFt, buildingRing, floorHeightFt, FT_TO_M } from '@/lib/floor-bands';
import type { BuildingWithSpaces, OccupancyKind } from '@/types';
import type { ContextBuilding } from '@/lib/city-context';
import type { Inside, Obstacle } from '@/lib/explore/walk';
import { floorPlateFor, plateMassing } from './plate';
import { populate } from '@/lib/explore/agents';
import type { StreetscapeResult } from '@/lib/streetscape';
import { buildBandGroups } from './bands3d';
import type { ColorOverrides } from '../map/colors';

/**
 * Puts Explore mode's three.js layer on the map, and takes it off again.
 *
 * The layer is added and removed rather than hidden, so that with Explore off
 * the flat map is byte-for-byte the map that shipped: no extra custom layer in
 * MapLibre's render list, no three.js renderer holding GL state, no scene
 * being walked every frame. That is the "never degrade the flat map" rule
 * expressed as a lifecycle rather than as a promise.
 */

export interface ExploreHandle {
  layer: ExploreLayer | null;
  /** Footprints and heights the walking capsule collides against. */
  obstacles: Obstacle[];
  /** Set while a broker is standing on a floor plate. */
  inside: Inside | null;
  /**
   * Bumped when the surveyed massing lands.
   *
   * deck.gl's own band layer takes its collar from the same profile — it is
   * invisible in Explore mode but it is what a click resolves against — and it
   * is built in `MapView`, which has no other way to know the asset arrived.
   * Without this the pickable geometry sits at the fallback ring while the
   * visible band sits on the surveyed one, so clicking a band on a tower with
   * setbacks would miss it.
   */
  lod2Ready: number;
}

export function useExplore(
  map: maplibregl.Map | null,
  active: boolean,
  buildings: BuildingWithSpaces[],
  preset: AtmospherePreset,
  anchor: [number, number],
  theme: 'dark' | 'light' = 'light',
  bands: {
    kinds: OccupancyKind[];
    selectedSpaceId: string | null;
    colorOverrides?: ColorOverrides;
  } = { kinds: ['available'], selectedSpaceId: null },
  cityContext: ContextBuilding[] = [],
  /** The floor a broker has stepped onto, from an availability's own card. */
  standingOn: { buildingId: string; floorNumber: number } | null = null,
  /** Streets, so cars and people have somewhere to be. */
  streetscape: StreetscapeResult | null = null,
): ExploreHandle {
  const handle = useRef<ExploreHandle>({
    layer: null,
    lod2Ready: 0,
    obstacles: [],
    inside: null,
  });

  // --- Lifecycle. The anchor is fixed for the life of the layer: it is the
  // origin of the scene's metric frame, and moving it would move every vertex.
  useEffect(() => {
    if (!map || !active) return;

    const layer = new ExploreLayer(anchor, preset);
    handle.current.layer = layer;

    const add = () => {
      // `addLayer` throws if the style is not loaded yet, and a style swap —
      // which the theme toggle does — drops every layer including this one.
      try {
        if (!map.getLayer(layer.id)) map.addLayer(layer as maplibregl.CustomLayerInterface);
      } catch {
        // The next style.load will bring it back.
      }
    };

    if (map.isStyleLoaded()) add();
    map.on('style.load', add);

    /**
     * Handed to the window so the browser harness can reach it.
     *
     * `verify-explore` has to project a known floor to a screen pixel and then
     * look at that pixel — there is no other way to prove a band and a facade
     * agree about where the 14th floor is, and this project has a documented
     * history of tests that passed while the feature was broken. Read-only
     * from outside, and nothing in the app reads it.
     */
    (window as unknown as { __explore?: ExploreLayer }).__explore = layer;

    return () => {
      map.off('style.load', add);
      try {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      } catch {
        // Already gone with the style it was attached to.
      }
      handle.current.layer = null;
      delete (window as unknown as { __explore?: ExploreLayer }).__explore;
    };
    // `preset` and `anchor` deliberately absent: the hour is pushed in below
    // without rebuilding the scene, and a moving anchor would rebuild it every
    // time the camera settled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, active, theme]);

  /**
   * The surveyed massing, fetched the first time Explore is opened.
   *
   * A tick of state rather than the promise's value, because everything that
   * consumes the asset reads it from a module-scope registry — the renderer
   * and the band builder meet nowhere else. The tick exists purely to rebuild
   * the geometry once it has landed.
   */
  const [lod2Tick, setLod2Tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void loadLod2().then(() => {
      if (live) setLod2Tick((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [active]);

  // --- Geometry.
  useEffect(() => {
    const layer = handle.current.layer;
    if (!layer || !active) return;
    layer.setBuildings(buildSpecs(layer, buildings));
  }, [active, buildings, lod2Tick]);

  // --- Availability. Separate from the massing because it changes far more
  // often: every filter, every selection, every colour override moves the
  // bands and none of them move a building.
  const kindKey = [...bands.kinds].sort().join(',');
  const overrideKey = bands.colorOverrides
    ? Object.entries(bands.colorOverrides).map(([k, v]) => `${k}:${v}`).sort().join('|')
    : '';
  useEffect(() => {
    const layer = handle.current.layer;
    if (!layer || !active) return;
    layer.setBands(
      buildBandGroups(layer.localFrame, {
        buildings,
        kinds: bands.kinds,
        selectedSpaceId: bands.selectedSpaceId,
        theme,
        colorOverrides: bands.colorOverrides,
        // Not on the glass you are looking through — see `BandInput`.
        hideBuildingId: standingOn?.buildingId ?? null,
      }),
    );
    // `bands` is a fresh object every render; its CONTENTS are the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    buildings,
    kindKey,
    bands.selectedSpaceId,
    theme,
    overrideKey,
    lod2Tick,
    standingOn?.buildingId,
  ]);

  // --- The surrounding city. Keyed on the payload's identity: `useCityContext`
  // returns the same array until a new viewport is actually fetched, so this
  // does not re-merge forty thousand footprints on every pan.
  useEffect(() => {
    const layer = handle.current.layer;
    if (!layer || !active) return;
    layer.setContext(buildContextMassing(layer, cityContext, buildings));
  }, [active, cityContext, buildings]);

  // --- The hour.
  useEffect(() => {
    handle.current.layer?.setPreset(preset);
  }, [preset]);

  /**
   * What a walker can bump into.
   *
   * Everything with a footprint, ours and the surrounding city alike. A walk
   * that passes through the anonymous grey building on the corner but not
   * through the one we hold a listing for would be worse than no collision at
   * all — it would teach you not to trust the walls.
   *
   * The FOOTPRINT rather than the surveyed cross-section, deliberately: at eye
   * height a building is its ground floor, and that is what the footprint is.
   */
  const obstacles = useMemo<Obstacle[]>(() => {
    const layer = handle.current.layer;
    if (!layer || !active) return [];

    const out: Obstacle[] = [];
    for (const b of detailedBuildings(buildings)) {
      const ring = buildingRing(b);
      if (!ring) continue;
      // Wound consistently, so "which side is out" is answerable the same
      // way for every obstacle rather than depending on how a given dataset
      // happened to order its vertices.
      out.push({
        ring: toCCW(ringToLocal(layer.localFrame, ring)),
        topM: buildingHeightFt(b) * FT_TO_M,
      });
    }
    for (const c of cityContext) {
      if (c.r.length < 4) continue;
      const topM = c.h * FT_TO_M;
      if (topM < 3) continue;
      out.push({ ring: toCCW(ringToLocal(layer.localFrame, c.r)), topM });
    }
    return out;
  }, [active, buildings, cityContext, lod2Tick]);

  /**
   * The floor plate, derived from the same maths a band is.
   *
   * Its outline is the building's own cross-section at that elevation and its
   * height is `(floor - 1) x floorHeight`, which is exactly what
   * `computeBands` uses. If the two ever disagreed, a broker would step onto
   * the 14th floor and find the Goldenrod band at their ankles.
   */
  const inside = useMemo<Inside | null>(() => {
    const layer = handle.current.layer;
    if (!layer || !active || !standingOn) return null;
    const building = buildings.find((b) => b.id === standingOn.buildingId);
    if (!building) return null;
    return floorPlateFor(layer.localFrame, building, standingOn.floorNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, buildings, standingOn?.buildingId, standingOn?.floorNumber, lod2Tick]);

  useEffect(() => {
    const layer = handle.current.layer;
    if (!layer) return;
    layer.setFloorPlate(
      inside ? inside.buildingId : null,
      inside ? plateMassing(inside) : null,
      inside,
    );
  }, [inside]);

  /**
   * Cars on the roadway, people on the pavements.
   *
   * Both come off the same road segments the flat map already draws, so they
   * are on the streets that are actually there rather than on a grid somebody
   * assumed. Populated once per streetscape payload — which is per viewport,
   * cached — rather than per frame.
   */
  useEffect(() => {
    const layer = handle.current.layer;
    if (!layer || !active) return;
    if (!streetscape || streetscape.roads.length === 0) {
      layer.setStreets(null);
      layer.setAgents([], []);
      return;
    }
    layer.setStreets(streetscape);
    const frame = layer.localFrame;
    layer.setAgents(
      populate(frame, streetscape.roads, {
        /**
         * Enough traffic that a street reads as a street.
         *
         * 420 was a car every couple of blocks — technically traffic, and from
         * the pavement it read as an unusually quiet Sunday. Manhattan is the
         * densest street network in the country and it should look it.
         */
        count: 900,
        /**
         * Faster than the famous seven-miles-an-hour average, on purpose.
         *
         * The average includes standing at lights, and this model has no
         * lights: at 3.2 m/s every car crawls continuously, which reads as
         * slower than real traffic rather than as the same. 6 m/s is a moving
         * car between junctions, which is what is being drawn.
         */
        speed: 6.0,
        lane: 'road',
        z: 0.02,
      }),
      populate(frame, streetscape.roads, {
        count: 1300,
        speed: 1.4,
        lane: 'kerb',
        z: 0.05,
        // A pavement on a fifteen-metre stub is not somewhere anyone walks.
        minLengthM: 45,
      }),
    );
  }, [active, streetscape]);

  handle.current.lod2Ready = lod2Tick;
  handle.current.obstacles = obstacles;
  handle.current.inside = inside;
  return handle.current;
}

/**
 * Buildings → scene geometry.
 *
 * Split out and exported so the massing can be counted and measured in a test
 * without a map, a canvas or a GPU. The triangle budget in the plan is a
 * number somebody has to be able to check.
 */
/**
 * The surrounding city as one merged buffer.
 *
 * BINs we already draw in full are skipped, or the tower carrying the data
 * would be buried inside an identical grey copy of itself — the flat map has
 * the same guard for the same reason.
 *
 * Anything under five metres is dropped. A one-storey garage is invisible from
 * any height this map is read at and there are tens of thousands of them.
 */
/**
 * Above this, a flat-topped box is the wrong shape and everybody can see it.
 *
 * Thirty storeys. The first value was twenty, and the cost was not the frame
 * budget — it was the *build*: stepping and parapeting nine hundred footprints
 * is several seconds of main-thread tessellation when a viewport loads, which
 * stalls the page rather than the renderer. The harness caught it as the
 * surrounding city simply not arriving inside its poll.
 *
 * Thirty storeys is where a New York building stops being a box with a flat
 * roof and starts being a silhouette, so the treatment is now aimed at the
 * buildings whose shape anybody is actually reading.
 */
const STEPPED_MIN_M = 92;

/** A ceiling on the cost, so one dense viewport cannot stall the page. */
const MAX_STEPPED = 220;

export function buildContextMassing(
  layer: ExploreLayer,
  context: ContextBuilding[],
  ours: BuildingWithSpaces[],
): MassingArrays | null {
  if (context.length === 0) return null;

  const ownBins = new Set(ours.map((b) => b.bin).filter((b): b is string => Boolean(b)));
  const parts: MassingArrays[] = [];

  /**
   * The surrounding city gets real shapes, not boxes — but only where a box
   * is actually wrong.
   *
   * Three tiers, and the tiering is the whole design:
   *
   * | Tier | What it gets | Why |
   * |---|---|---|
   * | Surveyed | The city's own LOD2 massing | Exact. Free — the asset is already loaded for our own towers, and it happens to carry neighbours |
   * | Tall (over `STEPPED_MIN_M`) | A stepped profile and a parapet | A flat-topped box is most obviously wrong on a tall building: setbacks and a roof edge are what a New York tower's silhouette *is* |
   * | Everything else | An extruded footprint | A six-storey loft genuinely is a box with a flat roof, and there are tens of thousands of them |
   *
   * Applying the full treatment to every footprint was the obvious thing and
   * it is unaffordable: it roughly tripled the context triangle count, which
   * on a scene already at its frame budget is the difference between a model
   * and a slideshow. Tiering targets the cost at the buildings whose
   * silhouette anybody is looking at.
   */
  let stepped = 0;
  for (const c of context) {
    if (c.b && ownBins.has(c.b)) continue;
    if (c.r.length < 4) continue;
    const heightM = c.h * FT_TO_M;
    if (heightM < 5) continue;

    const local = ringToLocal(layer.localFrame, c.r);

    // The city surveyed far more than our own towers; where it has a
    // neighbour, use it. Costs nothing — the asset is already in memory.
    const surveyed = c.b ? lod2For(c.b)?.massing : null;
    if (surveyed) {
      const arrays = massingToArrays(layer.localFrame, surveyed);
      if (arrays.triangles > 0) {
        parts.push(arrays);
        continue;
      }
    }

    if (heightM >= STEPPED_MIN_M && stepped < MAX_STEPPED) {
      stepped++;
      // No year for a context footprint, so the mildest profile the fallback
      // offers. It says "this is a tower with setbacks" without claiming to
      // know where they are — the same restraint §5 imposes on our own.
      const steps = fallbackSteps(heightM, null);
      parts.push(steppedMassing(local, steps));
      // A parapet is what stops a roof reading as a cut-off. One collar, and
      // it is the single cheapest thing that makes a skyline look built.
      parts.push(parapetMassing(local, insetRingLocal(local, 0.965), heightM, 1.1));
      continue;
    }

    parts.push(extrudedMassing(local, heightM));
  }

  return parts.length > 0 ? mergeMassings(parts) : null;
}

export function buildSpecs(
  layer: ExploreLayer,
  buildings: BuildingWithSpaces[],
): ExploreBuildingSpec[] {
  const specs: ExploreBuildingSpec[] = [];

  for (const building of detailedBuildings(buildings)) {
    const ring = buildingRing(building);
    if (!ring) continue;

    const local = ringToLocal(layer.localFrame, ring);
    const heightM = buildingHeightFt(building) * FT_TO_M;
    if (heightM <= 1) continue;

    const { height: floorFt } = floorHeightFt(building);
    const floorHeightM = floorFt * FT_TO_M;

    /**
     * The city's own survey where there is one, a stepped guess where there
     * is not.
     *
     * The fallback is not a degraded version of the same thing. §5 is explicit
     * that a building the 2014 capture predates falls back to its extruded
     * footprint rather than having setbacks invented for it, and the stepped
     * profile is the mildest thing that still says "this era of tower has
     * setbacks" without claiming to know where.
     */
    const surveyed = lod2For(building.bin)?.massing;
    let arrays;
    if (surveyed) {
      arrays = massingToArrays(layer.localFrame, surveyed);
      // A surveyed building with no usable surfaces — it happens, rarely, on
      // records that carry only a ground plane — must not render as nothing.
      if (arrays.triangles === 0) arrays = extrudedMassing(local, heightM);
    } else {
      const steps = fallbackSteps(heightM, building.year_built);
      arrays =
        steps.length > 1 ? steppedMassing(local, steps) : extrudedMassing(local, heightM);
    }

    /**
     * The roofscape, merged into the same buffer as the building.
     *
     * One mesh per building rather than one per parapet and tank: a tower's
     * roof furniture is a dozen small pieces, and at 400 buildings that is
     * five thousand draw calls against a budget of one thousand. They share
     * the building's material anyway — roof furniture is the same stone, and
     * it is never coloured by data.
     */
    const scape = roofMassing(layer.localFrame, roofscapeFor(building, surveyed ?? null));
    if (scape) arrays = mergeMassings([arrays, scape]);

    specs.push({
      id: building.id,
      arrays,
      floorHeightM,
      yearBuilt: building.year_built,
      surveyed: Boolean(surveyed),
    });
  }

  return specs;
}
