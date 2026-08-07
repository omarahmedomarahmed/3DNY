import { PolygonLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { circle as turfCircle } from '@turf/turf';
import {
  FT_TO_M,
  buildingHeightFt,
  buildingRing,
  computeFloorBands,
} from '@/lib/floor-bands';
import type { BuildingWithSpaces, ColorMode, FloorBand } from '@/types';
import {
  DIMMED_COLOR,
  FLOOR_BAND_COLOR,
  FLOOR_BAND_PARTIAL_COLOR,
  HOVER_COLOR,
  RADIUS_FILL,
  RADIUS_LINE,
  SELECTED_COLOR,
  colorForBuilding,
} from './colors';
import type { RGBA } from './colors';

/** Zoom at which floor bands appear for every building, not just the selection. */
export const BAND_ZOOM_THRESHOLD = 16;

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
  onBuildingClick: (buildingId: string) => void;
  onSpaceClick: (spaceId: string) => void;
  onHover: (buildingId: string | null) => void;
}

/** A polygon ring carrying a fixed z, so deck.gl extrudes from that base. */
type Ring3 = [number, number, number][];

interface BandDatum extends FloorBand {
  ring: Ring3;
  heightM: number;
  building: BuildingWithSpaces;
}

function ringWithZ(ring: [number, number][], z: number): Ring3 {
  return ring.map(([lon, lat]) => [lon, lat, z] as [number, number, number]);
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
    onBuildingClick,
    onSpaceClick,
    onHover,
  } = opts;

  const filteredIds = new Set(filtered.map((b) => b.id));
  const layers: Layer[] = [];

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
        onBuildingClick(info.object.id);
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
          onSpaceClick(info.object.spaceId);
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

  return layers;
}
