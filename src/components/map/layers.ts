import { PolygonLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { circle as turfCircle } from '@turf/turf';
import {
  FT_TO_M,
  buildingHeightFt,
  buildingRing,
  computeFloorBands,
} from '@/lib/floor-bands';
import type { BuildingWithSpaces, ColorMode, FloorBand } from '@/types';
import type { ContextBuilding } from '@/lib/city-context';
import {
  CITY_CONTEXT_COLOR,
  DIMMED_COLOR,
  FLOOR_BAND_COLOR,
  FLOOR_BAND_PARTIAL_COLOR,
  HOVER_COLOR,
  LABEL_BG_COLOR,
  LABEL_BORDER_COLOR,
  LABEL_TEXT_COLOR,
  RADIUS_FILL,
  RADIUS_LINE,
  SELECTED_COLOR,
  colorForBuilding,
} from './colors';
import type { RGBA } from './colors';

/** Zoom at which floor bands appear for every building, not just the selection. */
export const BAND_ZOOM_THRESHOLD = 16;

/**
 * Zoom at which each building gets a name-plate. Deliberately half a step
 * below the band threshold: the labels arrive first and tell you *what* you're
 * looking at, then the bands arrive and tell you *where* in the tower.
 */
export const LABEL_ZOOM_THRESHOLD = 15.5;

/** Canvas-relative pixel position of the click that opened something. */
export interface MapPoint {
  x: number;
  y: number;
}

export interface RadiusSelection {
  lon: number;
  lat: number;
  miles: number;
  originBuildingId: string | null;
}

export interface BuildLayersOptions {
  /** Every loaded building — used for the dimmed context layer. */
  buildings: BuildingWithSpaces[];
  /** Buildings passing the active filters. */
  filtered: BuildingWithSpaces[];
  selectedBuildingId: string | null;
  selectedSpaceId: string | null;
  hoveredBuildingId: string | null;
  colorMode: ColorMode;
  radius: RadiusSelection | null;
  zoom?: number;
  /** The surrounding city, from NYC footprints. Drawn beneath everything. */
  cityContext?: ContextBuilding[];
  /** `at` is where the pointer was, so the popup can anchor to the click. */
  onBuildingClick: (buildingId: string, at: MapPoint) => void;
  onSpaceClick: (spaceId: string, buildingId: string, at: MapPoint) => void;
  onHover: (buildingId: string | null) => void;
}

/** A polygon ring carrying a fixed z, so deck.gl extrudes from that base. */
type Ring3 = [number, number, number][];

interface BandDatum extends FloorBand {
  ring: Ring3;
  heightM: number;
  building: BuildingWithSpaces;
}

/** One name-plate: a position in the air above a tower plus its pill text. */
interface LabelDatum {
  buildingId: string;
  position: [number, number, number];
  text: string;
}

function ringWithZ(ring: [number, number][], z: number): Ring3 {
  return ring.map(([lon, lat]) => [lon, lat, z] as [number, number, number]);
}

/** Average of the ring vertices — close enough to a centroid for a label. */
function ringCenter(ring: [number, number][]): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
}

/**
 * The whole first line of the address — "1440 Broadway", not "1440". A bare
 * number is ambiguous the moment two streets are on screen at once, which is
 * most of the time in Midtown.
 *
 * Only the trailing city/state/zip is dropped, and only when it appears after
 * a comma. Addresses that are already one line come back untouched.
 */
function firstAddressLine(address: string): string {
  const trimmed = (address ?? '').trim();
  if (!trimmed) return '—';
  const line = (trimmed.split(/\s*[\n,]\s*/)[0] ?? trimmed).trim();
  return line || trimmed;
}

/** Lowest asking rent as a compact whole number, or "Withheld". */
function lowestRentLabel(b: BuildingWithSpaces): string {
  const rent = b.minRent ?? b.maxRent;
  if (rent === null || rent === undefined || !Number.isFinite(rent)) {
    return 'Withheld';
  }
  return `$${Math.round(rent)}`;
}

/**
 * Two lines: the street address, then the economics. A full address and a rent
 * side by side make a pill wide enough to cover its neighbours, so the rent
 * drops underneath where it costs no horizontal room.
 */
function labelText(b: BuildingWithSpaces): string {
  const spaces = b.spaceCount === 1 ? '1 space' : `${b.spaceCount} spaces`;
  return `${firstAddressLine(b.address_display)}\n${lowestRentLabel(b)}  ·  ${spaces}`;
}

export function buildLayers(opts: BuildLayersOptions): Layer[] {
  const {
    buildings,
    filtered,
    selectedBuildingId,
    selectedSpaceId,
    hoveredBuildingId,
    colorMode,
    radius,
    zoom = 0,
    cityContext,
    onBuildingClick,
    onSpaceClick,
    onHover,
  } = opts;

  const filteredIds = new Set(filtered.map((b) => b.id));
  const layers: Layer[] = [];

  // --- The city itself. Drawn first so everything with data sits on top of it,
  // and never pickable: this is scenery, and a click that selects a random
  // warehouse in the middle of a meeting is worse than no scenery at all.
  //
  // BINs we already render are skipped, otherwise the tower carrying the data
  // would be buried inside an identical gray copy of itself.
  if (cityContext && cityContext.length > 0) {
    const ownBins = new Set(
      buildings.map((b) => b.bin).filter((bin): bin is string => Boolean(bin)),
    );
    const scenery = cityContext.filter((c) => !c.b || !ownBins.has(c.b));

    if (scenery.length > 0) {
      layers.push(
        new PolygonLayer<ContextBuilding>({
          id: 'city-context',
          data: scenery,
          extruded: true,
          filled: true,
          stroked: false,
          wireframe: false,
          pickable: false,
          // More diffuse than the filtered-out massing, not less: a city with
          // no face shading is a fog bank. The separation between lit and
          // shaded walls is what makes it read as buildings, and the fill is
          // desaturated enough that it still cannot be mistaken for data.
          material: {
            ambient: 0.66,
            diffuse: 0.55,
            shininess: 1,
            specularColor: [255, 255, 255],
          },
          getPolygon: (c) => c.r,
          getElevation: (c) => c.h * FT_TO_M,
          getFillColor: CITY_CONTEXT_COLOR,
        }),
      );
    }
  }

  // --- Context: everything the filters excluded, kept as dim massing so the
  // map never empties out mid-meeting.
  const context = buildings.filter(
    (b) => !filteredIds.has(b.id) && buildingRing(b) !== null,
  );

  if (context.length > 0) {
    layers.push(
      new PolygonLayer<BuildingWithSpaces>({
        id: 'buildings-context',
        data: context,
        extruded: true,
        filled: true,
        stroked: false,
        wireframe: false,
        pickable: false,
        // Mostly ambient: context massing should read as flat pale gray with
        // just enough shading to separate faces, never as a lit object
        // competing with the matches.
        material: { ambient: 0.85, diffuse: 0.25, shininess: 1, specularColor: [255, 255, 255] },
        getPolygon: (b) => buildingRing(b) ?? [],
        getElevation: (b) => buildingHeightFt(b) * FT_TO_M,
        getFillColor: DIMMED_COLOR,
        updateTriggers: {
          getFillColor: [filtered.length],
        },
      }),
    );
  }

  // --- Matching buildings, coloured by the active mode.
  const active = filtered.filter((b) => buildingRing(b) !== null);

  layers.push(
    new PolygonLayer<BuildingWithSpaces>({
      id: 'buildings',
      data: active,
      extruded: true,
      filled: true,
      stroked: false,
      wireframe: false,
      pickable: true,
      autoHighlight: false,
      // High ambient keeps the fill colour close to the legend swatch; a modest
      // diffuse term still separates the lit and shaded faces on a white
      // background. Specular is dropped so deep Midnight tones don't blow out.
      material: { ambient: 0.72, diffuse: 0.45, shininess: 1, specularColor: [255, 255, 255] },
      getPolygon: (b) => buildingRing(b) ?? [],
      getElevation: (b) => buildingHeightFt(b) * FT_TO_M,
      getFillColor: (b): RGBA => {
        if (b.id === selectedBuildingId) return SELECTED_COLOR;
        if (b.id === hoveredBuildingId) {
          const [r, g, bl] = colorForBuilding(b, colorMode);
          // Pull the hovered building toward Goldenrod. On the old dark theme
          // this lifted toward white; on a white basemap that would erase it.
          return [
            Math.round((r + HOVER_COLOR[0]) / 2),
            Math.round((g + HOVER_COLOR[1]) / 2),
            Math.round((bl + HOVER_COLOR[2]) / 2),
            255,
          ];
        }
        return colorForBuilding(b, colorMode);
      },
      onClick: (info: PickingInfo<BuildingWithSpaces>) => {
        if (!info.object) return false;
        onBuildingClick(info.object.id, { x: info.x, y: info.y });
        return true;
      },
      onHover: (info: PickingInfo<BuildingWithSpaces>) => {
        onHover(info.object ? info.object.id : null);
        return false;
      },
      updateTriggers: {
        getFillColor: [colorMode, selectedBuildingId, hoveredBuildingId, active.length],
        getElevation: [active.length],
      },
    }),
  );

  // --- Floor bands: the selected tower always, everything else once the user
  // is zoomed in enough for the stripes to be legible.
  const showAllBands = zoom >= BAND_ZOOM_THRESHOLD;
  const bandSources = active.filter(
    (b) => showAllBands || b.id === selectedBuildingId,
  );

  const bands: BandDatum[] = [];
  for (const building of bandSources) {
    for (const band of computeFloorBands(building, building.spaces)) {
      const heightM = Math.max(0.5, (band.topFt - band.baseFt) * FT_TO_M);
      bands.push({
        ...band,
        building,
        heightM,
        ring: ringWithZ(band.polygon, band.baseFt * FT_TO_M),
      });
    }
  }

  if (bands.length > 0) {
    layers.push(
      new PolygonLayer<BandDatum>({
        id: 'floor-bands',
        data: bands,
        extruded: true,
        filled: true,
        stroked: false,
        wireframe: false,
        pickable: true,
        elevationScale: 1,
        // Nearly unlit, so Goldenrod stays Goldenrod on every face and the
        // bands read as a clean stripe across the Midnight-toned massing.
        material: { ambient: 0.92, diffuse: 0.16, shininess: 1, specularColor: [255, 255, 255] },
        getPolygon: (d) => d.ring,
        getElevation: (d) => d.heightM,
        getFillColor: (d): RGBA =>
          d.spaceId === selectedSpaceId
            ? SELECTED_COLOR
            : d.portion === 'partial'
              ? FLOOR_BAND_PARTIAL_COLOR
              : FLOOR_BAND_COLOR,
        onClick: (info: PickingInfo<BandDatum>) => {
          if (!info.object) return false;
          // Returning true stops deck.gl from also dispatching the click to the
          // building layer underneath.
          onSpaceClick(info.object.spaceId, info.object.buildingId, {
            x: info.x,
            y: info.y,
          });
          return true;
        },
        onHover: (info: PickingInfo<BandDatum>) => {
          onHover(info.object ? info.object.buildingId : null);
          return false;
        },
        updateTriggers: {
          getFillColor: [selectedSpaceId, colorMode],
          getElevation: [bands.length],
          getPolygon: [bands.length, selectedBuildingId, showAllBands],
        },
      }),
    );
  }

  // --- Radius ring around the selected building.
  if (radius && radius.miles > 0) {
    const poly = turfCircle([radius.lon, radius.lat], radius.miles, {
      units: 'miles',
      steps: 96,
    });
    const ring = poly.geometry.coordinates[0] as [number, number][];

    layers.push(
      new PolygonLayer<{ ring: [number, number][] }>({
        id: 'radius-ring',
        data: [{ ring }],
        extruded: false,
        filled: true,
        stroked: true,
        pickable: false,
        getPolygon: (d) => d.ring,
        getFillColor: RADIUS_FILL,
        getLineColor: RADIUS_LINE,
        getLineWidth: 3,
        lineWidthUnits: 'pixels',
        updateTriggers: {
          getPolygon: [radius.lon, radius.lat, radius.miles],
        },
      }),
    );
  }

  // --- Name-plates. Drawn last so they sit above the massing, and with depth
  // testing off so a label is never swallowed by the tower it belongs to.
  if (zoom >= LABEL_ZOOM_THRESHOLD && active.length > 0) {
    const labels: LabelDatum[] = [];
    for (const b of active) {
      const ring = buildingRing(b);
      if (!ring || ring.length === 0) continue;
      const [lon, lat] = ringCenter(ring);
      labels.push({
        buildingId: b.id,
        position: [lon, lat, buildingHeightFt(b) * FT_TO_M],
        text: labelText(b),
      });
    }

    if (labels.length > 0) {
      layers.push(
        new TextLayer<LabelDatum>({
          id: 'building-labels',
          data: labels,
          // Labels are a reading aid, not a target: picking stays with the
          // massing and the bands so a click never lands on a pill.
          pickable: false,
          billboard: true,
          background: true,
          getPosition: (d) => d.position,
          getText: (d) => d.text,
          getSize: 12,
          sizeUnits: 'pixels',
          lineHeight: 1.35,
          characterSet: 'auto',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
          fontWeight: 700,
          getColor: LABEL_TEXT_COLOR,
          getBackgroundColor: LABEL_BG_COLOR,
          getBorderColor: LABEL_BORDER_COLOR,
          getBorderWidth: 1,
          backgroundPadding: [7, 4, 7, 4],
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'bottom',
          getPixelOffset: [0, -8],
          parameters: { depthCompare: 'always' },
          updateTriggers: {
            getText: [colorMode, active.length],
            getPosition: [active.length],
          },
        }),
      );
    }
  }

  return layers;
}
