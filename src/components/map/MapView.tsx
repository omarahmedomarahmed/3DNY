'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { MapboxOverlay } from '@deck.gl/mapbox';
import {
  AmbientLight,
  DirectionalLight,
  LightingEffect,
  _SunLight,
  type PickingInfo,
} from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';

import { BRAND, SURFACE } from '@/lib/brand';
import { useApp } from '@/lib/store';
import { applyFilters } from '@/lib/filters';
import type { BuildingWithSpaces } from '@/types';
import { BAND_ZOOM_THRESHOLD, buildLayers, type MapPoint } from './layers';
import { useCityContext } from './useCityContext';
import {
  ATMOSPHERE,
  DEFAULT_TIME,
  skySpec,
  type AtmospherePreset,
} from './atmosphere';
import { useStreetscape } from './useStreetscape';
import type { ViewportBounds } from './ground';
import { useTransit } from './useTransit';
import { buildingHeightFt, buildingRing } from '@/lib/floor-bands';
import { composeSnapshot, downloadSnapshot, SNAPSHOT_SIDE } from '@/lib/stack-snapshot';
import type { Landlord } from '@/types';
import { MODE_LABEL, metersBetween, walkMinutes, type TransitStop } from '@/lib/transit';
import { transitSource } from '@/lib/provenance';
import SourceInfo from '@/components/ui/SourceInfo';
import {
  buildPhotorealLayer,
  loadPhotorealModule,
  photorealAvailable,
  photorealInRange,
  probePhotoreal,
  PHOTOREAL_MIN_ZOOM,
  type PhotorealModule,
} from './photoreal';

/** How long to wait for the first tile before calling the mode broken. */
const PHOTOREAL_LOAD_TIMEOUT_MS = 20000;
import MapLegend from './MapLegend';
import MapControls from './MapControls';
import RadiusControl from './RadiusControl';
import ResetView from './ResetView';
import SpacePopup from './SpacePopup';
import DraggableCard from './DraggableCard';
import TenantPopup from './TenantPopup';
import { useVisibleBuildings } from './useVisibleBuildings';
import { useExplore } from '../explore/useExplore';

const DEFAULT_CENTER: [number, number] = [-73.98, 40.75];

/**
 * The camera the map opens with, and the one "Reset the view" returns to.
 *
 * Named here rather than written twice: the opening pitch, the reset target
 * and the threshold that decides whether the reset button is worth showing all
 * have to be the same number, or the button appears on a map nobody has moved.
 */
const HOME_PITCH = 50;
const HOME_BEARING = -20;
const BAND_LABEL = 'Floor bands appear at zoom ' + BAND_ZOOM_THRESHOLD;

/**
 * Default basemap. Positron is key-free, pale gray/white with quiet labels, so
 * Midnight massing and Goldenrod bands stay the only saturated things on
 * screen — exactly the hierarchy the rest of the map is designed around.
 */
const CARTO_POSITRON_STYLE =
  'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

/**
 * The dark counterpart. Streets and labels drop away to near-black, which is
 * what makes a lit facade and a Goldenrod band carry a room — a bright white
 * map on a projector washes both out.
 */
const CARTO_DARK_STYLE =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const CARTO_ATTRIBUTION = '© OpenStreetMap contributors © CARTO';

function parseCenter(raw: string | undefined): [number, number] {
  if (!raw) return DEFAULT_CENTER;
  const parts = raw.split(',').map((p) => Number.parseFloat(p.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
    return DEFAULT_CENTER;
  }
  return [parts[0], parts[1]];
}

/**
 * Light basemap palette. Everything here is near-neutral on purpose: the
 * basemap is context, and the only saturated colour on screen should be the
 * building massing and the Goldenrod availability bands sitting on top of it.
 */
const BASEMAP = {
  land: '#F2F4F8',
  landuse: '#EAEEF4',
  water: '#DCE4EF',
  roadCasing: '#D2D6DD',
  roadFill: '#FFFFFF',
  boundary: '#C3CAD8',
  label: BRAND.midnight,
  labelHalo: SURFACE.white,
} as const;

/**
 * With no basemap URL configured the app still has to be demoable, so we fall
 * back to a style that requests nothing over the network at all.
 */
function blankLightStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': BASEMAP.land },
      },
    ],
  } as maplibregl.StyleSpecification;
}

function pmtilesStyle(url: string): maplibregl.StyleSpecification {
  // Symbol layers need a glyph endpoint, which is a network request the
  // offline fallback must never make. Labels are drawn only when one is
  // configured alongside the tiles.
  const glyphs = process.env.NEXT_PUBLIC_BASEMAP_GLYPHS;

  const layers: unknown[] = [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': BASEMAP.land },
    },
    {
      id: 'landuse',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'landuse',
      paint: { 'fill-color': BASEMAP.landuse, 'fill-opacity': 0.8 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'water',
      paint: { 'fill-color': BASEMAP.water },
    },
    {
      id: 'boundaries',
      type: 'line',
      source: 'basemap',
      'source-layer': 'boundaries',
      paint: { 'line-color': BASEMAP.boundary, 'line-width': 0.8 },
    },
    // Roads are drawn casing-first so they read as white ribbons with a light
    // gray edge rather than as flat lines lost in the land colour.
    {
      id: 'roads-casing',
      type: 'line',
      source: 'basemap',
      'source-layer': 'roads',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': BASEMAP.roadCasing,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.0, 16, 5.0],
      },
    },
    {
      id: 'roads',
      type: 'line',
      source: 'basemap',
      'source-layer': 'roads',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': BASEMAP.roadFill,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 16, 3.2],
      },
    },
  ];

  if (glyphs) {
    layers.push({
      id: 'place-labels',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'places',
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ['get', 'name:en']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 16, 14],
      },
      paint: {
        'text-color': BASEMAP.label,
        'text-halo-color': BASEMAP.labelHalo,
        'text-halo-width': 1.4,
      },
    });
  }

  return {
    version: 8,
    ...(glyphs ? { glyphs } : {}),
    sources: {
      basemap: {
        type: 'vector',
        url: `pmtiles://${url}`,
      },
    },
    layers,
  } as unknown as maplibregl.StyleSpecification;
}

/**
 * Basemap resolution, in priority order:
 *   1. NEXT_PUBLIC_BASEMAP_STYLE — a complete MapLibre style URL
 *   2. NEXT_PUBLIC_BASEMAP_URL   — self-hosted PMTiles
 *   3. CARTO Positron            — key-free, no configuration needed
 * Whatever is chosen, a load failure downgrades to the blank style rather than
 * leaving a broken map (see the `error` handler in the bootstrap effect).
 */
function resolveBasemap(theme: 'dark' | 'light'): {
  style: string | maplibregl.StyleSpecification;
  attribution: string | undefined;
  needsPmtiles: boolean;
} {
  const styleUrl = process.env.NEXT_PUBLIC_BASEMAP_STYLE;
  if (styleUrl) {
    return { style: styleUrl, attribution: undefined, needsPmtiles: false };
  }

  const pmtilesUrl = process.env.NEXT_PUBLIC_BASEMAP_URL;
  if (pmtilesUrl) {
    return {
      style: pmtilesStyle(pmtilesUrl),
      attribution: undefined,
      needsPmtiles: true,
    };
  }

  return {
    style: theme === 'dark' ? CARTO_DARK_STYLE : CARTO_POSITRON_STYLE,
    attribution: CARTO_ATTRIBUTION,
    needsPmtiles: false,
  };
}

/**
 * A real sun over Manhattan, at the chosen hour.
 *
 * `_SunLight` derives its direction from the viewport's own latitude and
 * longitude plus a timestamp, so the light is where the sun actually was — and
 * because the direction is fixed in the world rather than to the camera, the
 * lit faces and the shadows stay put as you orbit. That is what makes rotating
 * feel like walking around a model instead of spinning a picture.
 *
 * The hour comes from the atmosphere preset, so changing the time of day moves
 * the real sun rather than merely re-tinting the scene.
 */
function buildLighting(theme: 'dark' | 'light', preset: AtmospherePreset): LightingEffect {
  const effect = new LightingEffect({
    // Ambient carries most of the exposure and the sun supplies the modelling.
    // The split matters: too much directional intensity drove the blue channel
    // of Midnight-toned buildings to clip, which turned them electric cyan.
    ambient: new AmbientLight({
      color: [255, 255, 255],
      intensity: preset.ambient,
    }),
    sun: new _SunLight({
      timestamp: preset.timestamp,
      color: preset.sunColor,
      intensity: preset.sun,
      // Cast shadows are OFF, and this is not a stylistic choice.
      //
      // deck.gl's shadow support is experimental, and switching it on breaks
      // two things at once. Its shader module modifies the fragment colour
      // inside the same hook deck.gl uses to emit picking colours, so every
      // click resolved to the wrong object or to none — buildings simply
      // stopped being clickable. And the shadow map, at city scale over
      // facades carrying floor plates a few centimetres proud of the wall,
      // produced textbook shadow acne: the zig-zag banding that appeared on
      // every tower and read as another building's shadow falling across it.
      //
      // Nothing about the requirement is lost. The sun still takes its
      // direction from the viewport's latitude and longitude, so it stays
      // fixed in the world: orbit the map and the lit and shaded faces change
      // exactly as they should. Only ground shadows go, and they were the
      // part that was misbehaving.
      _shadow: false,
    }),
    // A cool bounce from the opposite side, standing in for skylight off the
    // buildings behind you. Keeps shaded faces from going flat.
    fill: new DirectionalLight({
      color: theme === 'dark' ? [120, 150, 205] : [206, 220, 242],
      intensity: 0.3,
      direction: [1, 1, -0.7],
    }),
  });

  // On white, a shadow is a blue-grey tint rather than the default near-black,
  // which reads as a hole punched in the map. On the dark map it has to be
  // darker than the ground it falls on, or it disappears.
  effect.shadowColor = theme === 'dark' ? [0, 0, 0, 0.45] : [0, 30, 90, 0.16];
  return effect;
}

/**
 * Puts the sky and its fog on the map.
 *
 * Wrapped because a basemap style that predates MapLibre's sky specification
 * rejects it, and losing the sky is a far better outcome than losing the map.
 */
function applySky(instance: maplibregl.Map, preset: AtmospherePreset) {
  try {
    instance.setSky(skySpec(preset) as Parameters<maplibregl.Map['setSky']>[0]);
  } catch {
    // No sky on this style. The deck.gl haze still carries the depth cue.
  }
}

/** Resolves once the map has stopped moving, with a floor on the wait. */
function settle(map: maplibregl.Map, minMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      map.off('idle', finish);
      setTimeout(resolve, minMs);
    };
    map.on('idle', finish);
    // A map that is already idle never fires the event.
    setTimeout(finish, 2500);
  });
}

/** One animation frame, so the last paint has actually landed. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Polls a predicate up to a deadline. Resolves either way — never throws. */
function waitFor(test: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (test() || Date.now() - started > timeoutMs) {
        resolve();
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

/** The landlord profile for one building, or null if there is not one yet. */
async function fetchLandlord(id: string): Promise<Landlord | null> {
  try {
    const res = await fetch('/api/landlords', { cache: 'no-store' });
    if (!res.ok) return null;
    const rows = (await res.json()) as Landlord[];
    return rows.find((l) => l.id === id) ?? null;
  } catch {
    // A snapshot without landlord notes is still worth having.
    return null;
  }
}

/**
 * Enlarges the basemap's street names.
 *
 * CARTO's styles are drawn for a map you look at, not one you present from:
 * road labels top out around 12px, which is unreadable across a conference
 * room and invisible once a building fills the frame. Every symbol layer whose
 * text comes from a road name is re-scaled, and given a heavier halo so it
 * survives being drawn over a tower.
 *
 * Applied by walking the loaded style rather than by forking it — the style is
 * fetched from CARTO at runtime, and a local copy would drift from theirs.
 */
function enlargeStreetLabels(map: maplibregl.Map, theme: 'dark' | 'light') {
  let style: maplibregl.StyleSpecification;
  try {
    style = map.getStyle();
  } catch {
    return;
  }
  if (!style?.layers) return;

  for (const layer of style.layers) {
    if (layer.type !== 'symbol') continue;
    // Road labels are the ones whose source layer is a road/transportation
    // layer. Place names are left alone: they are already sized for reading
    // and enlarging them buries the map.
    const sourceLayer = (layer as { 'source-layer'?: string })['source-layer'] ?? '';
    if (!/road|transportation|street/i.test(sourceLayer + layer.id)) continue;

    try {
      map.setLayoutProperty(layer.id, 'text-size', [
        'interpolate',
        ['linear'],
        ['zoom'],
        12, 12,
        14, 15,
        16, 20,
        18, 26,
      ]);
      map.setLayoutProperty(layer.id, 'text-letter-spacing', 0.02);
      map.setLayoutProperty(layer.id, 'symbol-placement', 'line');
      map.setPaintProperty(
        layer.id,
        'text-halo-color',
        theme === 'dark' ? '#05080F' : '#FFFFFF',
      );
      map.setPaintProperty(layer.id, 'text-halo-width', 2);
      map.setPaintProperty(
        layer.id,
        'text-color',
        theme === 'dark' ? '#D7E0F2' : '#2A3550',
      );
    } catch {
      // A layer that will not take one of these properties keeps its own.
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rentRange(b: BuildingWithSpaces): string {
  if (b.minRent === null && b.maxRent === null) return 'Rent withheld';
  if (b.minRent !== null && b.maxRent !== null && b.minRent !== b.maxRent) {
    return `$${Math.round(b.minRent)} – $${Math.round(b.maxRent)} /SF`;
  }
  const single = b.minRent ?? b.maxRent!;
  return `$${Math.round(single)} /SF`;
}

/** Either a building datum or a floor-band datum, which carries its building. */
type HoverPayload = Partial<BuildingWithSpaces> & {
  building?: BuildingWithSpaces;
  floorNumber?: number;
  portion?: string;
  /** Which space or tenancy the band stands for, so its size can be read. */
  recordId?: string;
  kind?: string;
  /** How many floors a run of band covers. One, unless it is a block. */
  floors?: number;
  label?: string;
};

/**
 * How to point the camera at one building.
 *
 * `fitBounds` frames a FOOTPRINT, which is a ground extent — but a building
 * rises out of it, and at this pitch a tall tower runs most of the way up the
 * screen. So the top padding scales with the building's own height, or the
 * roof lands outside the frame. The side padding keeps the tower clear of the
 * filter rail and the results sidebar, which overlay the map's edges.
 *
 * Shared by the selection fly-to and by Stack Snapshot, which had this
 * worked out first: a broker who has just clicked a building and a broker who
 * is capturing it want exactly the same shot.
 */
/**
 * Where to put the camera to look at one building.
 *
 * This used to hand the footprint's bounding box to `cameraForBounds` with
 * heavy asymmetric padding, and it was wrong in a way that was easy to miss
 * and impossible to unsee: **`cameraForBounds` does not account for pitch.**
 * It solves for a camera looking straight down, and this map flies at 55°. Add
 * up to 640px of top padding on a 1000px-tall viewport and the centre it
 * returns can be a couple of hundred metres from the building — which, at zoom
 * 17.6, is most of the screen. Clicking the Empire State Building landed the
 * camera 179m away from it. It looked like the map was flying somewhere at
 * random, because from the passenger seat that is exactly what it was doing.
 *
 * So nothing is solved for. The centre IS the building, the zoom comes from
 * how big its footprint is, and the headroom a tall tower needs is expressed
 * as a screen-space offset — which is the one mechanism here that MapLibre
 * does apply correctly under pitch.
 */
function frameBuilding(
  ring: [number, number][],
  heightFt: number,
  canvas: { width: number; height: number },
): { center: [number, number]; zoom: number; offset: [number, number] } {
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;
  for (const [lon, lat] of ring) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }

  const center: [number, number] = [(west + east) / 2, (south + north) / 2];
  const cos = Math.cos((center[1] * Math.PI) / 180);

  // The footprint's larger side, in metres.
  const spanM = Math.max(
    (east - west) * 111_320 * cos,
    (north - south) * 110_540,
    18,
  );

  /**
   * Zoom for the footprint AND for the height, whichever needs more room.
   *
   * Footprint alone is what a plan view needs and it is not what this is. A
   * pitched camera looking at the Empire State Building from close enough to
   * frame its 130m footprint fills the entire window with wall — the first
   * version of this did exactly that, and "framed on the building" turned out
   * to mean "pressed against it". A tall tower has to be further away than a
   * short one on the same plot.
   *
   * So height is converted into the ground span it effectively occupies and
   * the two constraints compete; the one that needs more distance wins. Both
   * are solved from the web-mercator ground resolution rather than guessed, so
   * a five-storey loft and a supertall both arrive whole.
   */
  const heightM = Math.max(0, heightFt) * 0.3048;
  const groundResolution = 156_543.03392 * cos; // metres per pixel at zoom 0

  /** Zoom at which `metres` covers `fraction` of `pixels`. */
  const zoomFor = (metres: number, fraction: number, pixels: number) =>
    Math.log2(groundResolution / (metres / (fraction * pixels)));

  const zoom = Math.min(
    // The plot, across the frame.
    zoomFor(spanM, 0.33, canvas.width),
    // The tower, up it. The 1.9 is the slack a pitched, perspective camera
    // needs, and it is generous on purpose: a vertical face leans toward the
    // viewer and reads far taller than its own metres would on a flat map, so
    // the honest conversion is nowhere near one-to-one. Tuned against the
    // Empire State Building, which at anything tighter has its crown — and the
    // bands near it — off the top of the frame.
    zoomFor(Math.max(heightM * 1.9, spanM), 0.62, canvas.height),
  );

  /**
   * Push the building below the middle of the frame so its height has sky.
   *
   * Positive Y moves the target down the screen. A tall tower drawn at 55°
   * occupies a lot of vertical space above its own footprint, and centring the
   * footprint runs the roof — and any availability near the top of it — off
   * the top edge. Capped at a third of the viewport so a very tall building
   * cannot push its own base off the bottom.
   */
  const headroom = Math.min(canvas.height * 0.22, heightFt * 0.16);

  return {
    center,
    zoom: Math.min(17.8, Math.max(15.2, zoom)),
    offset: [0, Math.round(headroom)],
  };
}

/** Every [lon, lat] we can frame the camera on. */
function buildingPoints(buildings: BuildingWithSpaces[]): [number, number][] {
  return buildings
    .filter((b) => b.lon !== null && b.lat !== null)
    .map((b) => [b.lon as number, b.lat as number] as [number, number]);
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [zoom, setZoom] = useState(14);
  // Tracked so the ground layers can drop geometry that is off screen. Updated
  // on settle rather than on every frame of a pan: the cull margin is wide
  // enough to cover the movement, and refiltering mid-gesture would cost more
  // than it saves.
  const [view, setView] = useState<ViewportBounds | null>(null);
  const [photorealCredits, setPhotorealCredits] = useState<string[]>([]);
  const [photorealError, setPhotorealError] = useState<string | null>(null);
  const [photorealModule, setPhotorealModule] = useState<PhotorealModule | null>(null);
  const [photorealInView, setPhotorealInView] = useState(false);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotStage, setSnapshotStage] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [photorealDrawn, setPhotorealDrawn] = useState(false);
  // The snapshot waits on this from inside an async function, where a state
  // value captured at call time would never update.
  const photorealDrawnRef = useRef(false);

  const buildings = useApp((s) => s.buildings);
  const filters = useApp((s) => s.filters);
  const colorMode = useApp((s) => s.colorMode);
  const selectedBuildingId = useApp((s) => s.selectedBuildingId);
  const selectedSpaceId = useApp((s) => s.selectedSpaceId);
  const hoveredBuildingId = useApp((s) => s.hoveredBuildingId);
  const colorOverrides = useApp((s) => s.colorOverrides);
  const popups = useApp((s) => s.popups);

  const radius = useApp((s) => s.radius);
  const photoreal = useApp((s) => s.photoreal);
  const mapMode = useApp((s) => s.mapMode);
  const showContext = useApp((s) => s.showContext);
  const mapTheme = useApp((s) => s.mapTheme);
  const timeOfDay = useApp((s) => s.timeOfDay);
  const showTransit = useApp((s) => s.showTransit);
  const transitModes = useApp((s) => s.transitModes);
  const occupancyKinds = useApp((s) => s.occupancyKinds);
  const isolateSelection = useApp((s) => s.isolateSelection);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);

  /** The hour the city is lit at — an explicit choice, or the theme's own. */
  const atmosphere = useMemo(
    () => ATMOSPHERE[timeOfDay ?? DEFAULT_TIME[mapTheme]],
    [timeOfDay, mapTheme],
  );

  const allFiltered = useMemo(() => {
    const matching = applyFilters(buildings, filters);

    // A building can be worth drawing with nothing available in it.
    //
    // `applyFilters` keeps a building only if one of its spaces passes, which
    // is right for an availability map and wrong the moment occupancy is
    // switched on: a tower where we placed a client but hold no listing was
    // dropped before its band could be drawn, so the one building a broker
    // most wants to point at was the one missing. Same for a building added by
    // hand that has no space on it yet.
    //
    // Only kinds actually being shown count, so this cannot resurrect
    // buildings for a layer that is switched off.
    const wanted = new Set(occupancyKinds.filter((k) => k !== 'available'));
    if (wanted.size === 0) return matching;

    const seen = new Set(matching.map((b) => b.id));
    const extra = buildings.filter((b) => {
      if (seen.has(b.id)) return false;
      return (b.tenants ?? []).some(
        (t) =>
          (t.floor_numbers ?? []).length > 0 &&
          wanted.has(t.relationship === 'client' ? 'client' : 'occupied'),
      );
    });
    return extra.length > 0 ? [...matching, ...extra] : matching;
  }, [buildings, filters, occupancyKinds]);

  /**
   * "Isolate" narrows the map to what is being discussed: the buildings inside
   * the radius if one is drawn, otherwise just the selected building. The
   * sidebar keeps listing everything, so nothing is lost — this is about what
   * is on screen when a client is looking at it.
   */
  const filtered = useMemo(() => {
    if (!isolateSelection) return allFiltered;
    if (radius) {
      return allFiltered.filter((b) => {
        if (b.lon === null || b.lat === null) return false;
        return (
          metersBetween([radius.lon, radius.lat], [b.lon, b.lat]) <=
          radius.miles * 1609.34
        );
      });
    }
    if (selectedBuildingId) {
      return allFiltered.filter((b) => b.id === selectedBuildingId);
    }
    return allFiltered;
  }, [allFiltered, isolateSelection, radius, selectedBuildingId]);

  useVisibleBuildings(map, filtered);


  // The surrounding city, so the towers that carry data stand in Manhattan
  // rather than in an empty plane.
  const cityContext = useCityContext(map, zoom, showContext);
  // Our own ground plane — always on (streets are orientation, not clutter),
  // except under photoreal imagery, which is its own ground.
  const streetscape = useStreetscape(map, zoom, !photoreal);
  const { stops: allTransitStops, error: transitError } = useTransit(map, zoom, showTransit);

  /**
   * Explore mode's three.js scene.
   *
   * The anchor is the origin of the scene's metric frame and is fixed for the
   * life of the layer, so it is the configured map centre rather than wherever
   * the camera happens to be — a frame that moved would move every vertex in
   * the city with it.
   */
  const exploreAnchor = useMemo(
    () => parseCenter(process.env.NEXT_PUBLIC_MAP_CENTER),
    [],
  );
  useExplore(map, mapMode === 'explore', filtered, atmosphere, exploreAnchor, mapTheme, {
    kinds: occupancyKinds,
    selectedSpaceId,
    colorOverrides,
  }, showContext ? cityContext : []);


  // An empty mode list means "all of them", so the map is useful before
  // anyone touches a filter.
  const transitStops = useMemo(
    () =>
      transitModes.length === 0
        ? allTransitStops
        : allTransitStops.filter((s) => transitModes.includes(s.mode)),
    [allTransitStops, transitModes],
  );

  /**
   * Station cards, resolved against the stops currently loaded.
   *
   * The store keeps a stop id rather than the stop itself, so a card cannot
   * outlive the data behind it: pan far enough that a station leaves the
   * fetched window and its card disappears with it, rather than sitting there
   * quoting a walk time to somewhere off screen.
   */
  const stationCards = useMemo(() => {
    const byId = new Map((transitStops ?? []).map((s) => [s.id, s]));
    return popups
      .filter((w) => w.kind === 'station')
      .map((w) => ({ w, stop: w.recordId ? byId.get(w.recordId) : undefined }))
      .filter((x): x is { w: typeof popups[number]; stop: TransitStop } => Boolean(x.stop));
  }, [popups, transitStops]);

  // Walk lines start at the selected building, so they appear the moment a
  // building is clicked and vanish when it is dismissed.
  const transitOrigin = useMemo<[number, number] | null>(() => {
    if (!showTransit || !selectedBuildingId) return null;
    const b = buildings.find((x) => x.id === selectedBuildingId);
    if (!b || b.lon === null || b.lat === null) return null;
    return [b.lon, b.lat];
  }, [showTransit, selectedBuildingId, buildings]);

  // --- Map bootstrap. Runs once; layer updates go through the overlay.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const basemap = resolveBasemap(useApp.getState().mapTheme);
    let protocol: { remove?: () => void } | null = null;

    if (basemap.needsPmtiles) {
      const p = new Protocol();
      maplibregl.addProtocol('pmtiles', p.tile);
      protocol = { remove: () => maplibregl.removeProtocol('pmtiles') };
    }

    const instance = new maplibregl.Map({
      container: containerRef.current,
      style: basemap.style,
      center: parseCenter(process.env.NEXT_PUBLIC_MAP_CENTER),
      zoom: 14,
      pitch: HOME_PITCH,
      bearing: HOME_BEARING,
      /**
       * All the way down to the street.
       *
       * MapLibre's default ceiling is 60°, which is a raised view of a block —
       * not the view from the pavement. The tilt buttons already offered to go
       * past it and the map silently refused, so pressing "raise the angle"
       * did nothing and looked broken.
       *
       * 85° is the library's own hard maximum and it is the interesting one:
       * the camera is essentially standing in the street looking up a facade,
       * which is how anyone actually judges whether the 14th floor has a view
       * or faces a wall. Past 85 the horizon is behind the camera and there is
       * nothing to render, which is why no map offers it.
       */
      maxPitch: 85,
      antialias: true,
      // Required for Stack Snapshot: without it the basemap's drawing buffer is
      // cleared as soon as the frame is presented, and every capture of it
      // comes back transparent. deck.gl's own canvas already preserves.
      preserveDrawingBuffer: true,
      attributionControl: {
        compact: true,
        ...(basemap.attribution ? { customAttribution: basemap.attribution } : {}),
      },
    });

    // A remote basemap is the one thing here that depends on the open
    // internet. If it never loads — offline demo, blocked CDN, corporate
    // proxy — the buildings still have to be on screen, so swap in the blank
    // style exactly once. Errors *after* the style is up (a stray tile 404)
    // are ignored: they must never blank a working map.
    let styleLoaded = false;
    let downgraded = false;
    const onStyleLoad = () => {
      styleLoaded = true;
      const state = useApp.getState();
      enlargeStreetLabels(instance, state.mapTheme);
      // A style load replaces the sky along with everything else, so it has to
      // be reapplied here rather than only when the hour changes.
      applySky(instance, ATMOSPHERE[state.timeOfDay ?? DEFAULT_TIME[state.mapTheme]]);
    };
    const onError = () => {
      if (styleLoaded || downgraded) return;
      downgraded = true;
      try {
        instance.setStyle(blankLightStyle());
      } catch {
        // Nothing further to try; the deck.gl overlay renders regardless.
      }
    };
    instance.on('style.load', onStyleLoad);
    instance.on('error', onError);

    const bootState = useApp.getState();
    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      effects: [
        buildLighting(
          bootState.mapTheme,
          ATMOSPHERE[bootState.timeOfDay ?? DEFAULT_TIME[bootState.mapTheme]],
        ),
      ],
      getTooltip: buildTooltip,
    });
    instance.addControl(overlay as unknown as maplibregl.IControl);

    const onSettle = () => {
      setZoom(instance.getZoom());
      const b = instance.getBounds();
      setView({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      });
    };
    instance.on('zoomend', onSettle);
    instance.on('moveend', onSettle);
    instance.on('load', onSettle);

    const canvas = instance.getCanvas();
    const onLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onRestored = () => setContextLost(false);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    mapRef.current = instance;
    overlayRef.current = overlay;
    setMap(instance);

    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      instance.off('zoomend', onSettle);
      instance.off('moveend', onSettle);
      instance.off('style.load', onStyleLoad);
      instance.off('error', onError);
      overlay.finalize();
      instance.remove();
      protocol?.remove?.();
      mapRef.current = null;
      overlayRef.current = null;
      setMap(null);
    };
  }, []);

  // Where the camera is decides whether the tiles are drawn at all. Tracked on
  // move rather than read during render, because the whole point is to stop the
  // traversal from ever seeing a wide, tilted frame.
  useEffect(() => {
    const instance = mapRef.current;
    if (!instance || !photoreal) {
      setPhotorealInView(false);
      setPhotorealDrawn(false);
      photorealDrawnRef.current = false;
      return;
    }

    const check = () =>
      setPhotorealInView(photorealInRange(instance.getCenter(), instance.getZoom()));

    check();
    instance.on('move', check);
    return () => {
      instance.off('move', check);
    };
  }, [photoreal, map]);

  // If the camera is somewhere the imagery should exist and none has arrived
  // after a reasonable wait, say so. Silence here is the worst outcome: the
  // grey city has stood down, the toggle looks on, and nothing explains it.
  useEffect(() => {
    if (!photoreal || !photorealInView || photorealDrawn) return;
    const timer = setTimeout(() => {
      setPhotorealError(
        'no imagery arrived. The key may be restricted to a different address, ' +
          'or the Map Tiles API may not be enabled for it.',
      );
      useApp.getState().setPhotoreal(false);
    }, PHOTOREAL_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [photoreal, photorealInView, photorealDrawn]);

  // Turning the mode on from a wide view would otherwise show nothing at all,
  // because the tiles are suppressed out there. Fly in instead of explaining.
  useEffect(() => {
    const instance = mapRef.current;
    if (!photoreal || !instance) return;
    if (instance.getZoom() < PHOTOREAL_MIN_ZOOM) {
      instance.easeTo({ zoom: PHOTOREAL_MIN_ZOOM, duration: 900 });
    }
  }, [photoreal]);

  // The tile reader is a megabyte of glTF machinery, so it is fetched the first
  // time someone asks for photorealistic buildings and never before.
  useEffect(() => {
    if (!photoreal || photorealModule) return;
    let live = true;

    // Probe and download in parallel, but only commit if both succeed — a
    // half-enabled photoreal mode is an empty map with no explanation.
    void Promise.all([loadPhotorealModule(), probePhotoreal()])
      .then(([mod, problem]) => {
        if (!live) return;
        if (problem) {
          setPhotorealError(problem);
          useApp.getState().setPhotoreal(false);
          return;
        }
        setPhotorealModule(mod);
      })
      .catch(() => {
        if (!live) return;
        setPhotorealError('the 3D tile reader could not be downloaded.');
        useApp.getState().setPhotoreal(false);
      });
    return () => {
      live = false;
    };
  }, [photoreal, photorealModule]);

  // Swapping the style rather than remounting the map: a remount would drop
  // the camera, the deck.gl overlay and every loaded tile.
  const firstTheme = useRef(true);
  useEffect(() => {
    const instance = mapRef.current;
    if (!instance) return;
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    try {
      instance.setStyle(resolveBasemap(mapTheme).style);
      // A style swap replaces every layer, so the label sizing and the sky
      // both have to be reapplied once the new one has loaded.
      instance.once('style.load', () => {
        enlargeStreetLabels(instance, mapTheme);
        applySky(instance, ATMOSPHERE[useApp.getState().timeOfDay ?? DEFAULT_TIME[mapTheme]]);
      });
    } catch {
      // A failed style swap leaves the previous basemap up, which is fine.
    }
  }, [mapTheme, map]);

  // --- The hour of the day: the real sun position, and the sky it sits in.
  useEffect(() => {
    const instance = mapRef.current;
    if (!instance) return;
    overlayRef.current?.setProps({ effects: [buildLighting(mapTheme, atmosphere)] });
    applySky(instance, atmosphere);
  }, [atmosphere, mapTheme, map]);

  /**
   * Flattens the two stacked WebGL canvases into one bitmap.
   *
   * The basemap is drawn first, then deck.gl's overlay on top, which is the
   * same order the screen composites them in. Both are read at their own
   * device resolution and the result is cropped to a square-ish frame centred
   * on the map, so a snapshot is not dominated by empty sky.
   */
  const captureMapImage = useCallback((): HTMLCanvasElement | null => {
    const instance = mapRef.current;
    if (!instance) return null;

    const base = instance.getCanvas();
    const deckCanvas = overlayRef.current?.getCanvas?.() as HTMLCanvasElement | undefined;

    // Compose at full size first, then crop. Cropping the source canvases
    // directly would need the two to agree on backing size, which they do not
    // when the device pixel ratio is fractional.
    const flat = document.createElement('canvas');
    flat.width = base.width;
    flat.height = base.height;
    const flatCtx = flat.getContext('2d');
    if (!flatCtx) return null;

    flatCtx.drawImage(base, 0, 0);
    if (deckCanvas) {
      flatCtx.drawImage(deckCanvas, 0, 0, flat.width, flat.height);
    }

    // A centred square. The map viewport is wide because the app is, but a
    // single framed building in a 16:9 frame is mostly empty ground.
    const side = Math.min(flat.width, flat.height);

    // Delivered at the sheet's own square size, upscaled when the window is
    // small rather than handing the composer fewer pixels than it draws into.
    //
    // The capture is only ever as detailed as the GPU rendered it — on a
    // non-Retina laptop in a small window that is around 900px, which is
    // where "very low quality" came from. Resampling here at least stops the
    // composer scaling it a second time, and on a Retina display the source
    // is already larger than the target so nothing is invented.
    const out = document.createElement('canvas');
    out.width = SNAPSHOT_SIDE;
    out.height = SNAPSHOT_SIDE;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      flat,
      Math.round((flat.width - side) / 2),
      Math.round((flat.height - side) / 2),
      side,
      side,
      0,
      0,
      SNAPSHOT_SIDE,
      SNAPSHOT_SIDE,
    );
    return out;
  }, []);

  /**
   * Stack Snapshot. Frames the building, waits for the map to settle, captures
   * it, and composes the sheet beside it.
   *
   * Photorealistic imagery can be switched on for the capture alone and put
   * back afterwards, so a snapshot can be photoreal without the map having to
   * be — which is the point: you pay Google for one building, not a session.
   */
  const takeStackSnapshot = useCallback(
    async (buildingId: string, wantPhotoreal: boolean) => {
      const instance = mapRef.current;
      if (!instance || snapshotBusy) return;

      const state = useApp.getState();
      const building = state.buildings.find((b) => b.id === buildingId);
      if (!building) return;

      const ring = buildingRing(building);
      if (!ring) {
        setSnapshotError('This building has no footprint yet, so there is nothing to capture.');
        return;
      }

      const restorePhotoreal = state.photoreal;
      setSnapshotBusy(true);
      setSnapshotError(null);
      setSnapshotStage('Framing the building…');

      try {
        // Frame it: tight on the footprint, pitched enough that the stack of
        // floors is visible rather than seen from directly above.
        const shotCanvas = instance.getCanvas();
        const shot = frameBuilding(ring, buildingHeightFt(building), {
          width: shotCanvas.clientWidth || 1200,
          height: shotCanvas.clientHeight || 800,
        });
        // The snapshot DOES fix the angle, unlike a click: it is composing a
        // picture that leaves the building and gets forwarded, so it has to
        // look the same whatever the camera happened to be doing.
        instance.easeTo({
          center: shot.center,
          zoom: shot.zoom,
          offset: shot.offset,
          pitch: 58,
          bearing: -20,
          duration: 900,
        });
        await settle(instance, 1400);

        if (wantPhotoreal && photorealAvailable()) {
          setSnapshotStage('Loading photorealistic imagery…');
          state.setPhotoreal(true);
          // The tiles arrive asynchronously; give them a bounded wait rather
          // than capturing a half-built mesh.
          await waitFor(() => useApp.getState().photoreal === false || photorealDrawnRef.current, 14000);
          await settle(instance, 1600);
        }

        setSnapshotStage('Capturing…');
        // One more frame, then read immediately — the buffers are preserved,
        // but the last paint still has to have happened.
        instance.triggerRepaint();
        await nextFrame();
        const mapImage = captureMapImage();
        if (!mapImage) throw new Error('The map could not be read.');

        setSnapshotStage('Composing the sheet…');
        const landlord = building.landlord_id
          ? await fetchLandlord(building.landlord_id)
          : null;

        const sheet = composeSnapshot({
          building,
          landlord,
          mapImage,
          capturedAt: new Date(),
          photoreal: wantPhotoreal && useApp.getState().photoreal,
        });
        downloadSnapshot(sheet, building);
        setSnapshotStage(null);
      } catch (err) {
        setSnapshotError((err as Error).message || 'The snapshot could not be created.');
        setSnapshotStage(null);
      } finally {
        if (useApp.getState().photoreal !== restorePhotoreal) {
          useApp.getState().setPhotoreal(restorePhotoreal);
        }
        setSnapshotBusy(false);
      }
    },
    [captureMapImage, snapshotBusy],
  );

  /** deck.gl reports canvas-relative pixels; the popup is viewport-positioned. */
  const toViewport = useCallback((at: MapPoint): { x: number; y: number } => {
    const instance = mapRef.current;
    if (!instance) return { x: at.x, y: at.y };
    const rect = instance.getCanvas().getBoundingClientRect();
    return { x: rect.left + at.x, y: rect.top + at.y };
  }, []);

  // Built once per session rather than on every render. A fresh Tile3DLayer
  // carries a fresh `loadOptions` object, and deck.gl treats that as a changed
  // layer — which is why changing the pitch was re-downloading the tileset
  // from scratch. The callbacks are stable, so nothing here needs rebuilding.
  const photorealLayer = useMemo(
    () =>
      photorealModule
        ? buildPhotorealLayer(photorealModule, {
            onAttribution: setPhotorealCredits,
            onFirstTile: () => {
              photorealDrawnRef.current = true;
              setPhotorealDrawn(true);
            },
            onError: (message) => {
              // Back out rather than leave the map with no city at all.
              setPhotorealError(message);
              useApp.getState().setPhotoreal(false);
            },
          })
        : null,
    [photorealModule],
  );

  const activePhotorealLayer = photoreal && photorealInView ? photorealLayer : null;

  // --- Layer sync.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const openSpace = (spaceId: string, buildingId: string, at: MapPoint) => {
      const state = useApp.getState();
      // selectBuilding clears the space selection, so it only fires when the
      // building actually changes — otherwise the band click would undo itself.
      if (state.selectedBuildingId !== buildingId) state.selectBuilding(buildingId);
      state.selectSpace(spaceId);
      const p = toViewport(at);
      state.openPopup({ kind: 'space', buildingId, recordId: spaceId, x: p.x, y: p.y });
    };

    overlay.setProps({
      // A click that hits nothing dismisses whatever is open. deck.gl calls
      // this for every click, including ones a layer already handled, so the
      // absence of a picked object is what distinguishes "clicked the map"
      // from "clicked a building".
      onClick: (info: PickingInfo) => {
        if (info.object) return;
        // Pinned cards survive: a click on empty map is "I am done with the
        // one I was reading", not "throw away the two I set aside".
        useApp.getState().closeUnpinnedPopups();
        useApp.getState().selectBuilding(null);
      },
      layers: buildLayers({
        buildings,
        filtered,
        selectedBuildingId,
        selectedSpaceId,
        hoveredBuildingId,
        colorMode,
        radius,
        zoom,
        cityContext,
        // Not simply "the mode is on": until a tile has actually drawn, the
        // free grey city stays. Handing over early is what turned a slow or
        // refused tile fetch into a blank map.
        photoreal: activePhotorealLayer !== null && photorealDrawn,
        showContext,
        theme: mapTheme,
        atmosphere,
        streetscape,
        view,
        transitStops,
        transitOrigin,
        colorOverrides,
        onTransitClick: (stop, at) => {
          const p = toViewport(at);
          useApp
            .getState()
            .openPopup({ kind: 'station', buildingId: '', recordId: stop.id, x: p.x, y: p.y });
        },
        onBuildingClick: (id, at) => {
          const state = useApp.getState();
          state.selectBuilding(id);

          // One availability means there is no list worth showing — go
          // straight to that space, exactly as if its band had been clicked.
          const target = state.buildings.find((b) => b.id === id);
          const actives = target ? target.spaces.filter((s) => s.is_active) : [];
          const only = actives.length === 1 ? actives[0].id : null;
          if (only) state.selectSpace(only);

          const p = toViewport(at);
          state.openPopup({ kind: 'space', buildingId: id, recordId: only, x: p.x, y: p.y });
        },
        onSpaceClick: openSpace,
        onTenantClick: (tenantId, buildingId, at) => {
          const p = toViewport(at);
          useApp
            .getState()
            .openPopup({ kind: 'tenant', buildingId, recordId: tenantId, x: p.x, y: p.y });
        },
        occupancyKinds,
        explore: mapMode === 'explore',
        onHover: (id) => useApp.getState().setHovered(id),
        photorealLayer: activePhotorealLayer,
      }),
    });
  }, [
    buildings,
    filtered,
    selectedBuildingId,
    selectedSpaceId,
    hoveredBuildingId,
    colorMode,
    radius,
    zoom,
    cityContext,
    streetscape,
    view,
    photoreal,
    mapMode,
    activePhotorealLayer,
    photorealDrawn,
    showContext,
    mapTheme,
    atmosphere,
    transitStops,
    transitOrigin,
    occupancyKinds,
    colorOverrides,
    toViewport,
  ]);

  // --- Frame the loaded inventory. Opening on a fixed centre leaves the towers
  // as specks somewhere off to one side; a broker opening this in a meeting
  // should see their availability immediately. Also drives "Fit to all".
  const fitAll = useCallback(
    (duration = 900, opts: { minZoom?: number; pitch?: number; bearing?: number } = {}) => {
      const instance = mapRef.current;
      if (!instance) return;

      const points = buildingPoints(buildings);
      if (points.length === 0) return;

      if (points.length === 1) {
        instance.easeTo({
          center: points[0],
          zoom: 16.5,
          pitch: opts.pitch ?? 55,
          ...(opts.bearing === undefined ? {} : { bearing: opts.bearing }),
          duration,
        });
        return;
      }

      const lons = points.map((p) => p[0]);
      const lats = points.map((p) => p[1]);
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ];
      // Room for the filter rail and results sidebar, which overlay the edges.
      /**
       * The angle rides along with the frame, in one camera command.
       *
       * Resetting used to be an `easeTo` for the angle followed by this for
       * the frame, and the second interrupted the first partway through — so
       * "reset the view" left the camera at whatever pitch the first animation
       * had reached when the second one cut in. One command, one destination.
       */
      const framing = {
        padding: { top: 90, bottom: 140, left: 80, right: 80 },
        maxZoom: 16.4,
        ...(opts.pitch === undefined ? {} : { pitch: opts.pitch }),
        ...(opts.bearing === undefined ? {} : { bearing: opts.bearing }),
      };

      // `fitBounds` takes a maxZoom and has no matching floor, so a caller that
      // wants one has to ask what the fit would be and clamp it. Going through
      // easeTo with the camera it computed keeps the centre identical — only
      // the zoom is raised.
      if (opts.minZoom !== undefined) {
        const camera = instance.cameraForBounds(bounds, framing);
        if (camera && (camera.zoom ?? 0) < opts.minZoom) {
          instance.easeTo({
            center: camera.center,
            zoom: opts.minZoom,
            ...(opts.pitch === undefined ? {} : { pitch: opts.pitch }),
            ...(opts.bearing === undefined ? {} : { bearing: opts.bearing }),
            duration,
          });
          return;
        }
      }

      instance.fitBounds(bounds, { ...framing, duration });
    },
    [buildings],
  );

  const framed = useRef(false);
  useEffect(() => {
    if (framed.current) return;
    if (!mapRef.current || buildingPoints(buildings).length === 0) return;
    framed.current = true;
    /**
     * Opening zoom has a floor, and "Fit to all" does not.
     *
     * With a couple of dozen Midtown towers, fitting everything opened on
     * legible city. With the market loaded the inventory runs from Fulton
     * Street to West 57th, and fitting that put the whole island on screen:
     * every tower a two-pixel speck, no floor bands (they start at 14.5), no
     * street names, nothing anyone could read aloud. Technically the right
     * frame and useless as a first impression.
     *
     * So the automatic frame stops zooming out at the point where a building
     * still looks like a building, and shows the densest part of the
     * inventory. The button beside the compass is unclamped and still fits
     * literally everything — because someone who presses "Fit to all" is
     * asking for the extent, not for legibility.
     */
    fitAll(900, { minZoom: 13.2 });
  }, [buildings, fitAll]);

  // --- Fly to the selection so its floor bands come into view.
  //
  // Framed on the footprint with height-aware padding rather than centred on
  // a point: centring puts the middle of the LOT in the middle of the screen,
  // which at this pitch runs a tall tower's roof — and any availability near
  // the top of it — straight off the top of the frame.
  //
  // The move itself is a flyTo rather than an easeTo. Crossing several blocks
  // at zoom 17 with a linear ease reads as the world being dragged past;
  // flyTo's arc pulls back, travels, and settles, which is legible as going
  // somewhere. `speed` and `curve` are tuned low and shallow because this
  // happens mid-sentence in a meeting — it has to be quick enough not to
  // interrupt and calm enough not to make anyone seasick on a projector.
  useEffect(() => {
    const instance = mapRef.current;
    if (!instance || !selectedBuildingId) return;
    const target = buildings.find((b) => b.id === selectedBuildingId);
    if (!target) return;
    const ring = buildingRing(target);
    if (!ring) return;

    const canvas = instance.getCanvas();
    const shot = frameBuilding(ring, buildingHeightFt(target), {
      width: canvas.clientWidth || 1200,
      height: canvas.clientHeight || 800,
    });

    instance.flyTo({
      center: shot.center,
      zoom: shot.zoom,
      offset: shot.offset,
      // The camera's own angle is left alone. Someone who has tilted to street
      // level to look up a facade has said what they want to see; snapping
      // back to 55° every time they click the next building takes it away
      // again, and they have to redo it for every building in the tour.
      speed: 1.1,
      curve: 1.3,
      essential: true,
    });
  }, [selectedBuildingId, buildings]);

  const showEmpty = !loading && !error && buildings.length === 0;

  /**
   * A station card goes stale when the selection moves; a building card does
   * not.
   *
   * This effect used to clear the transit popup alone, and when station cards
   * joined the shared popup list it became `closeUnpinnedPopups()` — which
   * fires on `selectedBuildingId`, which is set by the very click that opens a
   * building's card. The card opened and closed inside one click. What was
   * left was a building that flew into frame and told you nothing, which is a
   * far worse bug than the one it was standing in for.
   *
   * Only stations, then. Their whole content is "N minutes from the selected
   * building", so a new selection makes them wrong rather than merely old.
   */
  useEffect(() => {
    const state = useApp.getState();
    for (const w of state.popups) {
      if (w.kind === 'station' && !w.pinned) state.closePopup(w.id);
    }
  }, [selectedBuildingId, showTransit]);

  // --- One panel at a time.
  //
  // Compare is the only thing on this map big enough to be worth reading on
  // its own, and a space card or a station card floating over it is noise
  // rather than context. Opening the comparison dismisses whatever else was
  // open; while it stays open, nothing else takes its place — the click that
  // would open a space card closes the comparison first, which is the same
  // click-elsewhere rule every popup here already follows.
  const compareOpen = useApp((s) => s.compareOpen);
  useEffect(() => {
    if (!compareOpen) return;
    useApp.getState().closeUnpinnedPopups();
  }, [compareOpen]);

  return (
    <div className="relative h-full w-full bg-surface-sunken">
      {/* MapLibre's stylesheet sets `.maplibregl-map { position: relative }` and
          loads after Tailwind's utilities, so a className of `absolute inset-0`
          loses the specificity tie and the container collapses to zero height —
          a blank map with no error. Inline styles outrank both. */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {contextLost && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/85 p-6 text-center backdrop-blur-sm">
          <div className="max-w-sm rounded-card border border-hairline bg-white p-5 shadow-float">
            <div className="mb-1 text-base font-semibold text-ink">
              The 3D view lost its graphics context
            </div>
            <p className="mb-4 text-sm font-medium leading-relaxed text-muted">
              This usually happens when the machine sleeps or another app takes
              the GPU. Reloading the map restores it.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded bg-goldenrod px-3 py-1.5 text-sm font-semibold text-midnight transition-colors hover:bg-goldenrod-400"
            >
              Reload map
            </button>
          </div>
        </div>
      )}

      {showEmpty && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="rounded-card border border-hairline bg-white px-4 py-3 text-center text-sm font-medium text-body shadow-raised">
            No buildings loaded yet. Import an availability sheet to populate the
            map.
          </div>
        </div>
      )}

      {!showEmpty && buildings.length > 0 && filtered.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
          <div className="rounded-full border border-hairline bg-white px-3 py-1.5 text-sm font-semibold text-body shadow-card">
            No spaces match the current filters
          </div>
        </div>
      )}

      {error && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
          <div className="rounded-full border border-danger/30 bg-danger-surface px-3 py-1.5 text-sm font-semibold text-danger shadow-card">
            {error}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 z-10">
        {/* The expanded comparison covers the bottom-left corner entirely, so
            a legend underneath it is not hidden, it is half-hidden — which
            looks like a bug. It comes back when the panel is minimised. */}
        {!compareOpen && <MapLegend />}
        <RadiusControl />
        <ResetView
          map={map}
          home={{ pitch: HOME_PITCH, bearing: HOME_BEARING }}
          onReset={() => {
            // Everything at once: the selection is what pulled the camera in,
            // so leaving it set would have the fly-to effect drag it back the
            // moment anything re-renders.
            useApp.getState().selectBuilding(null);
            useApp.getState().closeUnpinnedPopups();
            fitAll(900, { minZoom: 13.2, pitch: HOME_PITCH, bearing: HOME_BEARING });
          }}
        />
        <MapControls
          map={map}
          onFitAll={() => fitAll(700)}
          canFitAll={buildingPoints(buildings).length > 0}
          onStackSnapshot={(withPhotoreal) => {
            if (selectedBuildingId) {
              void takeStackSnapshot(selectedBuildingId, withPhotoreal);
            }
          }}
          canSnapshot={Boolean(selectedBuildingId) && !snapshotBusy}
          snapshotBusy={snapshotBusy}
        />
        {photoreal && !photorealInView && (
          <div className="absolute left-1/2 bottom-4 -translate-x-1/2 rounded-full border border-hairline bg-white/95 px-3 py-1 text-[11px] font-medium text-body shadow-card">
            Photorealistic buildings appear closer in, over Manhattan
          </div>
        )}
        {photoreal && photorealInView && !photorealDrawn && (
          <div className="absolute left-1/2 bottom-4 -translate-x-1/2 rounded-full border border-hairline bg-white/95 px-3 py-1 text-[11px] font-medium text-body shadow-card">
            Loading photorealistic imagery…
          </div>
        )}
        {!photoreal && zoom < BAND_ZOOM_THRESHOLD && !selectedBuildingId && buildings.length > 0 && (
          <div className="absolute left-1/2 bottom-4 -translate-x-1/2 rounded-full border border-hairline bg-white/95 px-3 py-1 text-[11px] font-medium text-body shadow-card">
            {BAND_LABEL}
          </div>
        )}
      </div>

      {/* Google requires the copyright lines of whatever tiles are currently
          drawn to be shown. It sits above the MapLibre attribution so the two
          never overlap. */}
      {photoreal && photorealCredits.length > 0 && (
        <div className="pointer-events-none absolute bottom-8 right-2 z-20 max-w-md text-right">
          <span className="rounded bg-white/85 px-1.5 py-0.5 text-[10px] leading-tight text-subtle">
            {photorealCredits.join(', ')}
          </span>
        </div>
      )}

      {photorealError && (
        <div className="pointer-events-auto absolute inset-x-0 top-4 z-30 flex justify-center">
          <div className="flex items-center gap-3 rounded-full border border-warn/30 bg-warn-surface px-3 py-1.5 text-sm font-medium text-warn shadow-card">
            <span>Photorealistic buildings unavailable — {photorealError}</span>
            <button
              type="button"
              onClick={() => setPhotorealError(null)}
              className="text-xs underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {(snapshotStage || snapshotError) && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center">
          <div
            className={
              'rounded-full px-4 py-2 text-sm font-semibold shadow-float ' +
              (snapshotError
                ? 'border border-danger/30 bg-danger-surface text-danger'
                : 'border border-hairline bg-white text-ink')
            }
          >
            {snapshotError ?? snapshotStage}
          </div>
        </div>
      )}

      {/* The station card, in the same shell as every other map card: a
          station is a thing you click on the map, so dragging and pinning it
          have to work the same way. Pinning one beside a building card is how
          "how far is this floor from Grand Central" gets answered without
          losing either half of the question. */}
      {stationCards.map(({ w, stop }) => (
        <DraggableCard
          key={w.id}
          id={w.id}
          pinned={w.pinned}
          anchor={{ x: w.x, y: w.y }}
          width={272}
          ariaLabel={`${stop.name} station details`}
          title={MODE_LABEL[stop.mode]}
          onClose={() => useApp.getState().closePopup(w.id)}
        >
          <div className="p-3">
            <p className="flex items-center gap-1 text-sm font-semibold leading-snug text-ink">
              {stop.name}
              <SourceInfo label="this station" note={transitSource('name', stop.mode)} />
            </p>
            {stop.routes.length > 0 && (
              <p className="mt-1.5 flex flex-wrap items-center gap-1">
                {stop.routes.map((r) => (
                  <span
                    key={r}
                    className="rounded bg-midnight px-1.5 py-0.5 text-[11px] font-bold text-white"
                  >
                    {r}
                  </span>
                ))}
                <SourceInfo label="these routes" note={transitSource('routes', stop.mode)} />
              </p>
            )}
            {transitOrigin && (
              <p className="mt-2 flex items-center gap-1 text-xs font-medium text-body">
                <span>
                  About {walkMinutes(metersBetween(transitOrigin, [stop.lon, stop.lat]))} min
                  walk from the selected building
                </span>
                <SourceInfo label="this walk time" note={transitSource('walk_time')} />
              </p>
            )}
          </div>
        </DraggableCard>
      ))}

      {showTransit && transitError && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center">
          <div className="rounded-full border border-warn/30 bg-warn-surface px-3 py-1.5 text-sm font-medium text-warn shadow-card">
            {transitError}
          </div>
        </div>
      )}

      {/* Every open card. Pinning is what allows there to be more than one:
          two floors in the same tower, or the same floor in two towers, is the
          question this map exists to answer and it used to take two clicks and
          a memory. */}
      {popups.filter((w) => w.kind !== 'station').map((w) =>
        w.kind === 'tenant' ? (
          <TenantPopup
            key={w.id}
            popupId={w.id}
            pinned={w.pinned}
            tenantId={w.recordId ?? ''}
            buildingId={w.buildingId}
            at={{ x: w.x, y: w.y }}
            onClose={() => useApp.getState().closePopup(w.id)}
          />
        ) : (
          <SpacePopup
            key={w.id}
            popupId={w.id}
            pinned={w.pinned}
            buildingId={w.buildingId}
            spaceId={w.recordId}
            at={{ x: w.x, y: w.y }}
            onClose={() => useApp.getState().closePopup(w.id)}
            onSelectSpace={(spaceId) => {
              useApp.getState().selectSpace(spaceId);
              useApp.getState().setPopupRecord(w.id, spaceId);
            }}
          />
        ),
      )}
    </div>
  );
}

/** deck.gl tooltip. Runs on the picked object regardless of which layer hit. */
function buildTooltip(info: PickingInfo): { html: string; style: Record<string, string> } | null {
  const object = info.object as HoverPayload | undefined;
  if (!object) return null;

  const building: BuildingWithSpaces | undefined =
    object.building ??
    (object.spaces !== undefined && object.address_display !== undefined
      ? (object as BuildingWithSpaces)
      : undefined);

  if (!building) return null;

  const lines: string[] = [];
  lines.push(
    `<div style="font-weight:700;font-size:14px;color:#FFFFFF">${escapeHtml(
      building.address_display,
    )}</div>`,
  );
  if (building.building_name) {
    lines.push(
      `<div style="color:#DCE4EF">${escapeHtml(building.building_name)}</div>`,
    );
  }
  /**
   * Hovering a band answers "what is that stripe", and until now it answered
   * only half of it: which floor, and nothing about the space itself. The
   * size is the first thing anyone asks next — a broker scanning a tower is
   * looking for a floor plate that fits a headcount, not for floor 14 — so it
   * belongs on the hover rather than behind a click.
   */
  if (object.floorNumber !== undefined) {
    const portion = object.portion === 'partial' ? 'Partial' : 'Entire';
    const run =
      object.floors && object.floors > 1
        ? `${object.floorNumber}–${object.floorNumber + object.floors - 1}`
        : `${object.floorNumber}`;
    lines.push(
      `<div style="color:${BRAND.goldenrod};font-weight:600">${portion} floor ${run}</div>`,
    );

    const space = object.recordId
      ? building.spaces?.find((s) => s.id === object.recordId)
      : undefined;

    if (space) {
      const parts: string[] = [];
      if (space.sf !== null) parts.push(`${space.sf.toLocaleString('en-US')} SF`);
      parts.push(
        space.asking_rent_withheld || space.asking_rent_psf === null
          ? 'rent on request'
          : `$${space.asking_rent_psf}/SF`,
      );
      if (space.floor_label) parts.unshift(escapeHtml(space.floor_label));
      lines.push(
        `<div style="color:#FFFFFF;font-weight:600;font-size:14px">${parts.join(
          ' · ',
        )}</div>`,
      );
    } else if (object.label) {
      // A tenancy rather than an availability: no asking rent to show, but the
      // company name is the answer to the same question.
      lines.push(`<div style="color:#DCE4EF">${escapeHtml(object.label)}</div>`);
    }
  }

  lines.push(
    `<div style="color:#DCE4EF">${building.spaceCount} space${
      building.spaceCount === 1 ? '' : 's'
    } · ${escapeHtml(rentRange(building))}</div>`,
  );

  return {
    html: lines.join(''),
    // Midnight card, white type: high contrast is the whole point on a
    // projector, where the previous near-gray body text disappeared.
    style: {
      background: BRAND.midnight,
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '8px',
      boxShadow: '0 12px 32px rgba(0, 30, 90, 0.28)',
      color: '#FFFFFF',
      fontSize: '13px',
      fontWeight: '500',
      lineHeight: '1.35',
      padding: '9px 11px',
      pointerEvents: 'none',
    },
  };
}
