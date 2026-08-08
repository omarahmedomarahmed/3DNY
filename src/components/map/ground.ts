import { PathLayer, PolygonLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { FT_TO_M } from '@/lib/floor-bands';
import {
  layoutStreetNames,
  type RoadSegment,
  type StreetscapeResult,
  type StreetNameLabel,
  type WaterPolygon,
} from '@/lib/streetscape';
import { themeColors, type MapTheme } from './colors';

/**
 * The ground plane: our own streets, kerbs, sidewalks and water, drawn as
 * geometry instead of relying on the basemap image underneath. Once this is
 * on screen the basemap is fully covered — which is the point. The default
 * map owes nothing to any external tile server.
 *
 * Everything here is scenery: never pickable, never lit (material off, so the
 * ground reads as one consistent surface rather than shimmering with the
 * camera), and never allowed to compete with a Goldenrod availability band.
 */

/**
 * Level-of-detail thresholds, by zoom. Below each, that class of geometry is
 * withheld — both for the frame budget and because sub-pixel streets are
 * noise, not detail.
 */
export const GROUND_LOD = {
  /** Ordinary streets join the avenues. */
  streets: 13.2,
  /** Alleys, and the sidewalk band that gives blocks their kerb line. */
  lanes: 14.2,
  /** Painted street names on avenues and streets. */
  names: 15.0,
  /** Painted names on the narrowest streets. */
  allNames: 15.8,
} as const;

/**
 * The ground plane, sized to the geometry that was actually fetched rather
 * than to a fixed continent-sized quad.
 *
 * This is not an optimisation, it is a correctness fix. deck.gl projects
 * vertices into a common space anchored near the viewport, and a quad whose
 * corners sit 60km away loses enough float precision in the vertex shader that
 * its interpolated depth at the centre of the frame drifts by more than the
 * few centimetres separating it from the roads on top of it — so at close zoom
 * the plane won the depth test and the entire street network disappeared under
 * it. Keeping the corners a few kilometres out keeps the depth honest.
 *
 * The fetched bbox is already padded a third beyond the viewport; this pads it
 * again by its own span, which puts the edge comfortably past the horizon at
 * every zoom the ground is drawn at.
 */
function groundQuad(bbox: [number, number, number, number]): [number, number][] {
  const [w, s, e, n] = bbox;
  const padX = Math.max(e - w, 0.01);
  const padY = Math.max(n - s, 0.01);
  const west = w - padX;
  const east = e + padX;
  const south = s - padY;
  const north = n + padY;
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

/**
 * The ground is a stack of coplanar surfaces, and coplanar is exactly what a
 * depth buffer cannot resolve — the same trap the building wall, floor plates
 * and availability collar solve with three radii. Here the separation is
 * vertical: a few centimetres each, invisible from any real camera angle, but
 * enough that the roadbed always wins over the pavement and the pavement
 * always wins over the block.
 *
 * Ordered exactly as they are drawn. Anything else that lies flat on the
 * street — the contact shadows under the towers — stacks above the last of
 * them.
 */
export const GROUND_Z = {
  plane: 0,
  water: 0.03,
  sidewalk: 0.06,
  casing: 0.09,
  road: 0.12,
  name: 0.16,
} as const;

/** Where flat decoration drawn elsewhere must sit to clear the ground stack. */
export const GROUND_TOP_Z = 0.2;

/** Lifts a 2D polyline onto one of the ground strata. */
function atZ(line: [number, number][], z: number): [number, number, number][] {
  return line.map(([lon, lat]) => [lon, lat, z] as [number, number, number]);
}

/** Sidewalk reach beyond the kerb, in metres, by road tier. */
const SIDEWALK_M: Record<number, number> = { 0: 2.6, 1: 5.5, 2: 4.0, 3: 2.6 };

/** The kerb line's visible thickness on each side of the roadbed. */
const KERB_M = 0.8;

/** Painted name glyph height in metres, by road tier. */
const NAME_SIZE_M: Record<number, number> = { 0: 10, 1: 10, 2: 7.5, 3: 6 };

export interface GroundLayerOptions {
  streetscape: StreetscapeResult;
  theme: MapTheme;
  zoom: number;
}

export function buildGroundLayers(opts: GroundLayerOptions): Layer[] {
  const { streetscape, theme, zoom } = opts;
  const palette = themeColors(theme);
  const layers: Layer[] = [];

  // No data yet (or the fetch failed): leave the basemap visible rather than
  // covering it with a blank plane.
  if (streetscape.roads.length === 0) return layers;

  const roads =
    zoom >= GROUND_LOD.lanes
      ? streetscape.roads
      : zoom >= GROUND_LOD.streets
        ? streetscape.roads.filter((r) => r.t <= 2)
        : streetscape.roads.filter((r) => r.t <= 1);

  layers.push(
    new PolygonLayer<{ ring: [number, number][] }>({
      id: 'ground-plane',
      data: [{ ring: groundQuad(streetscape.bbox) }],
      extruded: false,
      filled: true,
      stroked: false,
      pickable: false,
      material: false,
      getPolygon: (d) => atZ(d.ring, GROUND_Z.plane),
      getFillColor: palette.ground,
      updateTriggers: {
        getFillColor: [theme],
        getPolygon: [streetscape.bbox.join(',')],
      },
    }),
  );

  if (streetscape.water.length > 0) {
    layers.push(
      new PolygonLayer<WaterPolygon>({
        id: 'ground-water',
        data: streetscape.water,
        extruded: false,
        filled: true,
        stroked: false,
        pickable: false,
        material: false,
        getPolygon: (d) => d.rings.map((ring) => atZ(ring, GROUND_Z.water)),
        getFillColor: palette.water,
        updateTriggers: { getFillColor: [theme] },
      }),
    );
  }

  // Three passes per street, widest first: pavement band, kerb line, roadbed.
  // Same flat plane, painter's order — the kerb is the sliver of casing left
  // visible between the other two.
  if (zoom >= GROUND_LOD.lanes) {
    layers.push(
      new PathLayer<RoadSegment>({
        id: 'ground-sidewalks',
        data: roads,
        pickable: false,
        widthUnits: 'meters',
        capRounded: true,
        jointRounded: true,
        getPath: (d) => atZ(d.p, GROUND_Z.sidewalk),
        getWidth: (d) => d.w * FT_TO_M + 2 * (SIDEWALK_M[d.t] ?? 3),
        getColor: palette.sidewalk,
        updateTriggers: { getColor: [theme] },
      }),
    );
  }

  layers.push(
    new PathLayer<RoadSegment>({
      id: 'ground-road-casing',
      data: roads,
      pickable: false,
      widthUnits: 'meters',
      capRounded: true,
      jointRounded: true,
      getPath: (d) => atZ(d.p, GROUND_Z.casing),
      getWidth: (d) => d.w * FT_TO_M + 2 * KERB_M,
      widthMinPixels: 1.4,
      getColor: palette.roadCasing,
      updateTriggers: { getColor: [theme] },
    }),
    new PathLayer<RoadSegment>({
      id: 'ground-roads',
      data: roads,
      pickable: false,
      widthUnits: 'meters',
      capRounded: true,
      jointRounded: true,
      getPath: (d) => atZ(d.p, GROUND_Z.road),
      getWidth: (d) => d.w * FT_TO_M,
      widthMinPixels: 1,
      getColor: palette.roadFill,
      updateTriggers: { getColor: [theme] },
    }),
  );

  // Street names painted onto the asphalt — flat in the world, not billboards,
  // like thermoplastic road lettering. They scale with the ground and vanish
  // into it at distance, so they can never cover a tower or a band.
  if (zoom >= GROUND_LOD.names) {
    const nameRoads =
      zoom >= GROUND_LOD.allNames ? streetscape.roads : streetscape.roads.filter((r) => r.t <= 2);
    const labels = layoutStreetNames(nameRoads);

    if (labels.length > 0) {
      layers.push(
        new TextLayer<StreetNameLabel>({
          id: 'ground-street-names',
          data: labels,
          pickable: false,
          billboard: false,
          sizeUnits: 'meters',
          sizeMaxPixels: 26,
          getPosition: (d) => [d.position[0], d.position[1], GROUND_Z.name],
          getText: (d) => d.text,
          getAngle: (d) => d.angle,
          getSize: (d) => NAME_SIZE_M[d.tier] ?? 7,
          characterSet: 'auto',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
          fontWeight: 700,
          fontSettings: { sdf: true, radius: 12 },
          outlineWidth: 3,
          outlineColor: palette.streetNameHalo,
          getColor: palette.streetName,
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          updateTriggers: {
            getColor: [theme],
            getPosition: [labels.length],
          },
        }),
      );
    }
  }

  return layers;
}
