'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { BAND_ZOOM_THRESHOLD, buildLayers } from './layers';
import MapLegend from './MapLegend';
import RadiusControl from './RadiusControl';
import { useVisibleBuildings } from './useVisibleBuildings';

const DEFAULT_CENTER: [number, number] = [-73.98, 40.75];
const BAND_LABEL = 'Floor bands appear at zoom ' + BAND_ZOOM_THRESHOLD;

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

export default function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [zoom, setZoom] = useState(14);

  const buildings = useApp((s) => s.buildings);
  const filters = useApp((s) => s.filters);
  const colorMode = useApp((s) => s.colorMode);
  const selectedBuildingId = useApp((s) => s.selectedBuildingId);
  const selectedSpaceId = useApp((s) => s.selectedSpaceId);
  const hoveredBuildingId = useApp((s) => s.hoveredBuildingId);
  const radius = useApp((s) => s.radius);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);

  const filtered = useMemo(
    () => applyFilters(buildings, filters),
    [buildings, filters],
  );

  useVisibleBuildings(map, filtered);

  // --- Map bootstrap. Runs once; layer updates go through the overlay.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const basemapUrl = process.env.NEXT_PUBLIC_BASEMAP_URL;
    let protocol: { remove?: () => void } | null = null;
    let style: maplibregl.StyleSpecification;

    if (basemapUrl) {
      const p = new Protocol();
      maplibregl.addProtocol('pmtiles', p.tile);
      protocol = { remove: () => maplibregl.removeProtocol('pmtiles') };
      style = pmtilesStyle(basemapUrl);
    } else {
      style = blankLightStyle();
    }

    const instance = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: parseCenter(process.env.NEXT_PUBLIC_MAP_CENTER),
      zoom: 14,
      pitch: 50,
      bearing: -20,
      antialias: true,
      attributionControl: false,
    });

    instance.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      'top-right',
    );

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
      overlay.finalize();
      instance.remove();
      protocol?.remove?.();
      mapRef.current = null;
      overlayRef.current = null;
      setMap(null);
    };
  }, []);

  // --- Layer sync.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const { selectBuilding, selectSpace, setHovered } = useApp.getState();

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
        onBuildingClick: (id) => selectBuilding(id),
        onSpaceClick: (id) => selectSpace(id),
        onHover: (id) => setHovered(id),
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
  ]);

  // --- Frame the loaded inventory on first paint. Opening on a fixed centre
  // leaves the towers as specks somewhere off to one side; a broker opening
  // this in a meeting should see their availability immediately.
  const framed = useRef(false);
  useEffect(() => {
    const instance = mapRef.current;
    if (!instance || framed.current) return;

    const points = buildings
      .filter((b) => b.lon !== null && b.lat !== null)
      .map((b) => [b.lon as number, b.lat as number] as [number, number]);
    if (points.length === 0) return;

    framed.current = true;

    if (points.length === 1) {
      instance.easeTo({ center: points[0], zoom: 16.5, pitch: 55, duration: 800 });
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
      { padding: { top: 90, bottom: 140, left: 80, right: 80 }, maxZoom: 16.4, duration: 900 },
    );
  }, [buildings]);

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
            <div className="mb-1 text-sm font-semibold text-ink">
              The 3D view lost its graphics context
            </div>
            <p className="mb-4 text-xs leading-relaxed text-muted">
              This usually happens when the machine sleeps or another app takes
              the GPU. Reloading the map restores it.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded bg-goldenrod px-3 py-1.5 text-xs font-semibold text-midnight transition-colors hover:bg-goldenrod-400"
            >
              Reload map
            </button>
          </div>
        </div>
      )}

      {showEmpty && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="rounded-card border border-hairline bg-white px-4 py-3 text-center text-xs text-muted shadow-raised">
            No buildings loaded yet. Import an availability sheet to populate the
            map.
          </div>
        </div>
      )}

      {!showEmpty && buildings.length > 0 && filtered.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
          <div className="rounded-full border border-hairline bg-white px-3 py-1.5 text-[11px] font-medium text-body shadow-card">
            No spaces match the current filters
          </div>
        </div>
      )}

      {error && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
          <div className="rounded-full border border-danger/30 bg-danger-surface px-3 py-1.5 text-[11px] font-medium text-danger shadow-card">
            {error}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 z-10">
        <MapLegend />
        <RadiusControl />
        {zoom < BAND_ZOOM_THRESHOLD && !selectedBuildingId && buildings.length > 0 && (
          <div className="absolute left-1/2 bottom-4 -translate-x-1/2 rounded-full border border-hairline bg-white/95 px-3 py-1 text-[10px] text-muted shadow-card">
            {BAND_LABEL}
          </div>
        )}
      </div>
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
    `<div style="font-weight:600;color:#fff">${escapeHtml(building.address_display)}</div>`,
  );
  if (building.building_name) {
    lines.push(
      `<div style="color:#8b949e">${escapeHtml(building.building_name)}</div>`,
    );
  }
  if (object.floorNumber !== undefined) {
    const portion = object.portion === 'partial' ? 'Partial' : 'Entire';
    lines.push(
      `<div style="color:#4c9aff">${portion} floor ${object.floorNumber}</div>`,
    );
  }
  lines.push(
    `<div style="color:#8b949e">${building.spaceCount} space${
      building.spaceCount === 1 ? '' : 's'
    } · ${escapeHtml(rentRange(building))}</div>`,
  );

  return {
    html: lines.join(''),
    style: {
      background: '#161b22',
      border: '1px solid #2b3441',
      borderRadius: '6px',
      color: '#e6edf3',
      fontSize: '12px',
      padding: '8px 10px',
      pointerEvents: 'none',
    },
  };
}
