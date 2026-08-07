'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { MapboxOverlay } from '@deck.gl/mapbox';
import {
  AmbientLight,
  DirectionalLight,
  LightingEffect,
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
  buildPhotorealLayer,
  loadPhotorealModule,
  photorealAvailable,
  probePhotoreal,
  type PhotorealModule,
} from './photoreal';
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
function resolveBasemap(): {
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
    style: CARTO_POSITRON_STYLE,
    attribution: CARTO_ATTRIBUTION,
    needsPmtiles: false,
  };
}

/**
 * Extrusions have to read against a near-white ground. A strong ambient term
 * keeps fills close to the legend swatches, and two directional lights — a key
 * from the south-west plus a weak fill — separate adjacent faces so towers
 * don't collapse into flat silhouettes.
 */
const LIGHTING = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 1.5 }),
  key: new DirectionalLight({
    color: [255, 255, 255],
    intensity: 1.05,
    direction: [-1, -3, -1],
  }),
  fill: new DirectionalLight({
    color: [214, 224, 240],
    intensity: 0.6,
    direction: [2, 1, -1.2],
  }),
});

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

  const buildings = useApp((s) => s.buildings);
  const filters = useApp((s) => s.filters);
  const colorMode = useApp((s) => s.colorMode);
  const selectedBuildingId = useApp((s) => s.selectedBuildingId);
  const selectedSpaceId = useApp((s) => s.selectedSpaceId);
  const hoveredBuildingId = useApp((s) => s.hoveredBuildingId);
  const radius = useApp((s) => s.radius);
  const photoreal = useApp((s) => s.photoreal);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);

  const filtered = useMemo(
    () => applyFilters(buildings, filters),
    [buildings, filters],
  );

  useVisibleBuildings(map, filtered);

  // The surrounding city, so the towers that carry data stand in Manhattan
  // rather than in an empty plane.
  const cityContext = useCityContext(map, zoom);

  // --- Map bootstrap. Runs once; layer updates go through the overlay.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const basemap = resolveBasemap();
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
      effects: [LIGHTING],
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

  /** deck.gl reports canvas-relative pixels; the popup is viewport-positioned. */
  const toViewport = useCallback((at: MapPoint): PopupAnchor => {
    const instance = mapRef.current;
    if (!instance) return { x: at.x, y: at.y };
    const rect = instance.getCanvas().getBoundingClientRect();
    return { x: rect.left + at.x, y: rect.top + at.y };
  }, []);

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

    const photorealLayer = photoreal
      ? buildPhotorealLayer(photorealModule, {
          onAttribution: setPhotorealCredits,
          onError: (message) => {
            // Back out rather than leave the map with no city at all.
            setPhotorealError(message);
            useApp.getState().setPhotoreal(false);
          },
        })
      : null;

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
        photoreal: photoreal && photorealLayer !== null,
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
        photorealLayer,
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
    photorealModule,
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
        />
        {zoom < BAND_ZOOM_THRESHOLD && !selectedBuildingId && buildings.length > 0 && (
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
