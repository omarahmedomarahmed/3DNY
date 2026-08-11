'use client';

import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { ExploreLayer, type ExploreBuildingSpec } from './ExploreLayer';
import type { AtmospherePreset } from '../map/atmosphere';
import { ringToLocal } from '@/lib/explore/frame';
import {
  extrudedMassing,
  fallbackSteps,
  mergeMassings,
  steppedMassing,
  type MassingArrays,
} from '@/lib/explore/massing';
import { detailedBuildings } from '@/lib/explore/eligibility';
import { buildingHeightFt, buildingRing, floorHeightFt, FT_TO_M } from '@/lib/floor-bands';
import type { BuildingWithSpaces, OccupancyKind } from '@/types';
import type { ContextBuilding } from '@/lib/city-context';
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
): ExploreHandle {
  const handle = useRef<ExploreHandle>({ layer: null });

  // --- Lifecycle. The anchor is fixed for the life of the layer: it is the
  // origin of the scene's metric frame, and moving it would move every vertex.
  useEffect(() => {
    if (!map || !active) return;

    const layer = new ExploreLayer(anchor, preset, theme);
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

  // --- Geometry.
  useEffect(() => {
    const layer = handle.current.layer;
    if (!layer || !active) return;
    layer.setBuildings(buildSpecs(layer, buildings));
  }, [active, buildings]);

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
      }),
    );
    // `bands` is a fresh object every render; its CONTENTS are the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, buildings, kindKey, bands.selectedSpaceId, theme, overrideKey]);

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
export function buildContextMassing(
  layer: ExploreLayer,
  context: ContextBuilding[],
  ours: BuildingWithSpaces[],
): MassingArrays | null {
  if (context.length === 0) return null;

  const ownBins = new Set(ours.map((b) => b.bin).filter((b): b is string => Boolean(b)));
  const parts: MassingArrays[] = [];

  for (const c of context) {
    if (c.b && ownBins.has(c.b)) continue;
    if (c.r.length < 4) continue;
    const heightM = c.h * FT_TO_M;
    if (heightM < 5) continue;
    parts.push(extrudedMassing(ringToLocal(layer.localFrame, c.r), heightM));
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
     * Stepped, from year built and height — until sprint 3 puts the city's
     * surveyed massing behind this. The fallback stays afterwards, for the two
     * buildings in seventy-three that the 2014 survey predates.
     */
    const steps = fallbackSteps(heightM, building.year_built);
    const arrays =
      steps.length > 1
        ? steppedMassing(local, steps)
        : extrudedMassing(local, heightM);

    specs.push({
      id: building.id,
      arrays,
      floorHeightM,
      yearBuilt: building.year_built,
    });
  }

  return specs;
}
