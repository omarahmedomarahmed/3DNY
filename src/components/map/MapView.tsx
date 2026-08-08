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
import { useTransit } from './useTransit';
import { buildingHeightFt, buildingRing } from '@/lib/floor-bands';
import { composeSnapshot, downloadSnapshot } from '@/lib/stack-snapshot';
import type { Landlord } from '@/types';
import { MODE_LABEL, metersBetween, walkMinutes, type TransitStop } from '@/lib/transit';
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
import SpacePopup, { type PopupAnchor } from './SpacePopup';
import { useVisibleBuildings } from './useVisibleBuildings';

const DEFAULT_CENTER: [number, number] = [-73.98, 40.75];
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
 * A real sun over Manhattan, casting real shadows.
 *
 * `_SunLight` derives its direction from the viewport's own latitude and
 * longitude plus a timestamp, so the light is where the sun actually was — and
 * because the direction is fixed in the world rather than to the camera, the
 * lit faces and the shadows stay put as you orbit. That is what makes rotating
 * feel like walking around a model instead of spinning a picture.
 *
 * Mid-morning in June, chosen deliberately: the sun is high enough that streets
 * are not lost in shadow, and far enough east that towers throw long, readable
 * shadows down the avenues.
 */
const SUN_TIMESTAMP = Date.UTC(2025, 5, 21, 14, 30);

function buildLighting(theme: 'dark' | 'light'): LightingEffect {
  const effect = new LightingEffect({
    // Ambient carries most of the exposure and the sun supplies the modelling.
    // The split matters: too much directional intensity drove the blue channel
    // of Midnight-toned buildings to clip, which turned them electric cyan.
    ambient: new AmbientLight({
      color: [255, 255, 255],
      intensity: theme === 'dark' ? 1.0 : 1.25,
    }),
    sun: new _SunLight({
      timestamp: SUN_TIMESTAMP,
      color: [255, 250, 238],
      intensity: 0.65,
      _shadow: true,
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
};

interface PopupState {
  buildingId: string;
  /** Null while a multi-space building is showing its floor list. */
  spaceId: string | null;
  at: PopupAnchor;
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
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [photorealCredits, setPhotorealCredits] = useState<string[]>([]);
  const [photorealError, setPhotorealError] = useState<string | null>(null);
  const [photorealModule, setPhotorealModule] = useState<PhotorealModule | null>(null);
  const [photorealInView, setPhotorealInView] = useState(false);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotStage, setSnapshotStage] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [transitPopup, setTransitPopup] = useState<{
    stop: TransitStop;
    at: PopupAnchor;
  } | null>(null);
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
  const radius = useApp((s) => s.radius);
  const photoreal = useApp((s) => s.photoreal);
  const showContext = useApp((s) => s.showContext);
  const mapTheme = useApp((s) => s.mapTheme);
  const showTransit = useApp((s) => s.showTransit);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);

  const filtered = useMemo(
    () => applyFilters(buildings, filters),
    [buildings, filters],
  );

  useVisibleBuildings(map, filtered);

  // The surrounding city, so the towers that carry data stand in Manhattan
  // rather than in an empty plane.
  const cityContext = useCityContext(map, zoom, showContext);
  const { stops: transitStops, error: transitError } = useTransit(map, zoom, showTransit);

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
      pitch: 50,
      bearing: -20,
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

    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      effects: [buildLighting(useApp.getState().mapTheme)],
      getTooltip: buildTooltip,
    });
    instance.addControl(overlay as unknown as maplibregl.IControl);

    const onZoom = () => setZoom(instance.getZoom());
    instance.on('zoomend', onZoom);
    instance.on('load', onZoom);

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
      instance.off('zoomend', onZoom);
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
      overlayRef.current?.setProps({ effects: [buildLighting(mapTheme)] });
    } catch {
      // A failed style swap leaves the previous basemap up, which is fine.
    }
  }, [mapTheme, map]);

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
    const out = document.createElement('canvas');
    out.width = side;
    out.height = side;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(
      flat,
      Math.round((flat.width - side) / 2),
      Math.round((flat.height - side) / 2),
      side,
      side,
      0,
      0,
      side,
      side,
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
        // fitBounds frames the FOOTPRINT, which is a ground extent — but the
        // building rises out of it, and at this pitch a tall tower runs most of
        // the way up the screen. So the top padding scales with the building's
        // own height, or the roof lands outside the frame.
        const heightFt = buildingHeightFt(building);
        const topPad = Math.min(640, Math.max(220, 150 + heightFt * 0.62));
        instance.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          {
            padding: { top: topPad, bottom: 150, left: 260, right: 260 },
            pitch: 58,
            duration: 900,
            maxZoom: 17.4,
          },
        );
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
  const toViewport = useCallback((at: MapPoint): PopupAnchor => {
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
      setPopup({ buildingId, spaceId, at: toViewport(at) });
    };

    overlay.setProps({
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
        transitStops,
        transitOrigin,
        onTransitClick: (stop, at) => setTransitPopup({ stop, at: toViewport(at) }),
        onBuildingClick: (id, at) => {
          const state = useApp.getState();
          state.selectBuilding(id);

          // One availability means there is no list worth showing — go
          // straight to that space, exactly as if its band had been clicked.
          const target = state.buildings.find((b) => b.id === id);
          const actives = target ? target.spaces.filter((s) => s.is_active) : [];
          const only = actives.length === 1 ? actives[0].id : null;
          if (only) state.selectSpace(only);

          setPopup({ buildingId: id, spaceId: only, at: toViewport(at) });
        },
        onSpaceClick: openSpace,
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
    photoreal,
    activePhotorealLayer,
    photorealDrawn,
    showContext,
    mapTheme,
    transitStops,
    transitOrigin,
    toViewport,
  ]);

  // --- Frame the loaded inventory. Opening on a fixed centre leaves the towers
  // as specks somewhere off to one side; a broker opening this in a meeting
  // should see their availability immediately. Also drives "Fit to all".
  const fitAll = useCallback(
    (duration = 900) => {
      const instance = mapRef.current;
      if (!instance) return;

      const points = buildingPoints(buildings);
      if (points.length === 0) return;

      if (points.length === 1) {
        instance.easeTo({ center: points[0], zoom: 16.5, pitch: 55, duration });
        return;
      }

      const lons = points.map((p) => p[0]);
      const lats = points.map((p) => p[1]);
      instance.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        // Room for the filter rail and results sidebar, which overlay the edges.
        {
          padding: { top: 90, bottom: 140, left: 80, right: 80 },
          maxZoom: 16.4,
          duration,
        },
      );
    },
    [buildings],
  );

  const framed = useRef(false);
  useEffect(() => {
    if (framed.current) return;
    if (!mapRef.current || buildingPoints(buildings).length === 0) return;
    framed.current = true;
    fitAll();
  }, [buildings, fitAll]);

  // --- Fly to the selection so its floor bands come into view.
  useEffect(() => {
    const instance = mapRef.current;
    if (!instance || !selectedBuildingId) return;
    const target = buildings.find((b) => b.id === selectedBuildingId);
    if (!target || target.lon === null || target.lat === null) return;

    instance.easeTo({
      center: [target.lon, target.lat],
      zoom: Math.max(instance.getZoom(), 17),
      pitch: 55,
      duration: 900,
    });
  }, [selectedBuildingId, buildings]);

  const showEmpty = !loading && !error && buildings.length === 0;
  useEffect(() => {
    setTransitPopup(null);
  }, [selectedBuildingId, showTransit]);

  const closePopup = useCallback(() => setPopup(null), []);

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
        <MapLegend />
        <RadiusControl />
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

      {transitPopup && (
        <div
          className="pointer-events-auto fixed z-40 w-64 -translate-x-1/2 -translate-y-full rounded-card border border-hairline bg-white p-3 shadow-float"
          style={{ left: transitPopup.at.x, top: transitPopup.at.y - 12 }}
          onClick={() => setTransitPopup(null)}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            {MODE_LABEL[transitPopup.stop.mode]}
          </p>
          <p className="mt-1 text-sm font-semibold leading-snug text-ink">
            {transitPopup.stop.name}
          </p>
          {transitPopup.stop.routes.length > 0 && (
            <p className="mt-1.5 flex flex-wrap gap-1">
              {transitPopup.stop.routes.map((r) => (
                <span
                  key={r}
                  className="rounded bg-midnight px-1.5 py-0.5 text-[11px] font-bold text-white"
                >
                  {r}
                </span>
              ))}
            </p>
          )}
          {transitOrigin && (
            <p className="mt-2 text-xs font-medium text-body">
              About{' '}
              {walkMinutes(
                metersBetween(transitOrigin, [transitPopup.stop.lon, transitPopup.stop.lat]),
              )}{' '}
              min walk from the selected building
            </p>
          )}
          <p className="mt-2 text-[10px] leading-snug text-subtle">
            Stop locations from OpenStreetMap. Walk time is estimated, not routed.
          </p>
        </div>
      )}

      {showTransit && transitError && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center">
          <div className="rounded-full border border-warn/30 bg-warn-surface px-3 py-1.5 text-sm font-medium text-warn shadow-card">
            {transitError}
          </div>
        </div>
      )}

      {popup && (
        <SpacePopup
          key={popup.buildingId}
          buildingId={popup.buildingId}
          spaceId={popup.spaceId}
          at={popup.at}
          onClose={closePopup}
          onSelectSpace={(spaceId) => {
            useApp.getState().selectSpace(spaceId);
            setPopup((prev) => (prev ? { ...prev, spaceId } : prev));
          }}
        />
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
  if (object.floorNumber !== undefined) {
    const portion = object.portion === 'partial' ? 'Partial' : 'Entire';
    lines.push(
      `<div style="color:${BRAND.goldenrod};font-weight:600">${portion} floor ${object.floorNumber}</div>`,
    );
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
