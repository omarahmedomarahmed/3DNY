'use client';

import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { ExploreLayer, type ExploreBuildingSpec } from './ExploreLayer';
import type { AtmospherePreset } from '../map/atmosphere';
import { ringToLocal } from '@/lib/explore/frame';
import { extrudedMassing, fallbackSteps, steppedMassing } from '@/lib/explore/massing';
import { detailedBuildings } from '@/lib/explore/eligibility';
import { buildingHeightFt, buildingRing, floorHeightFt, FT_TO_M } from '@/lib/floor-bands';
import type { BuildingWithSpaces, OccupancyKind } from '@/types';
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

    return () => {
      map.off('style.load', add);
      try {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      } catch {
        // Already gone with the style it was attached to.
      }
      handle.current.layer = null;
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
