import { ColumnLayer, PolygonLayer } from '@deck.gl/layers';
import type { Layer, LayerExtension } from '@deck.gl/core';
import { FT_TO_M } from '@/lib/floor-bands';
import {
  computeRoofscape,
  type ParapetBand,
  type RoofBox,
  type RoofCylinder,
} from '@/lib/roofscape';
import type { Building } from '@/types';
import { themeColors, type MapTheme, type RGBA } from './colors';

/**
 * Roof furniture, drawn from the derived roofscape.
 *
 * Everything here is scenery: never pickable, so a click at the top of a tower
 * still selects the tower rather than its water tank, and never coloured by
 * data. It is silhouette — the thing that makes a skyline a skyline — and it
 * is deliberately quiet, because the loudest thing on screen has to stay the
 * Goldenrod band.
 */

/**
 * Roofs appear here. Below it a parapet is well under a pixel and a water tank
 * is invisible, so the whole pass is skipped and the geometry never built.
 */
export const ROOF_ZOOM = 14.6;

/** The surrounding grey city gets roofs later — there are thousands of them. */
export const CONTEXT_ROOF_ZOOM = 16.2;

/**
 * How many context buildings get roof furniture. Tallest first, so the ones
 * that define the skyline are the ones that get it, and the frame budget is
 * spent where it shows.
 */
export const CONTEXT_ROOF_LIMIT = 260;

/**
 * Roof furniture has to be lit by the SAME material as the massing it stands
 * on, or it reads as something pasted onto the building rather than part of
 * it. That is not a subtlety: given its own material, the plant on the grey
 * city came out as dark caps sitting on pale white towers, because the
 * context massing's broad white specular lifts it to near-white while a
 * restrained specular leaves the roofs dark.
 *
 * So there are two, mirroring the two massing materials in `layers.ts`.
 */
const ROOF_MATERIAL = {
  ambient: 0.62,
  diffuse: 0.6,
  shininess: 12,
  specularColor: [38, 44, 58] as [number, number, number],
};

/** Matches the `city-context` massing material exactly. Keep them in step. */
const CONTEXT_ROOF_MATERIAL = {
  ambient: 0.62,
  diffuse: 0.55,
  shininess: 4,
  specularColor: [58, 66, 84] as [number, number, number],
};

/** ColumnLayer takes one radius per layer, so cylinders are grouped by size. */
const CYLINDER_BUCKETS = [
  { key: 'slim', maxR: 1.2 },
  { key: 'mid', maxR: 2.6 },
  { key: 'wide', maxR: Infinity },
];

/** A roof piece carries the colour of the building it belongs to. */
type Tinted<T> = T & { color: RGBA };

interface RoofPieces {
  parapets: Tinted<ParapetBand>[];
  boxes: Tinted<RoofBox>[];
  tanks: Tinted<RoofCylinder>[];
  posts: Tinted<RoofCylinder>[];
}

/**
 * Darkens a colour toward its own shadow, keeping the hue.
 *
 * Roof furniture is the same building seen from a different angle, so it takes
 * the building's own colour rather than a shared grey. A shared grey made the
 * plant read as an object sitting on the tower instead of part of it — and on
 * a Goldenrod-adjacent building it introduced a second colour at the top of
 * the silhouette, which is exactly where the eye should not be pulled.
 */
function shade(color: RGBA, factor: number): RGBA {
  return [
    Math.round(color[0] * factor),
    Math.round(color[1] * factor),
    Math.round(color[2] * factor),
    255,
  ];
}

/** Blends toward a target colour by `t`, keeping full opacity. */
function towards(color: RGBA, target: RGBA, t: number): RGBA {
  return [
    Math.round(color[0] + (target[0] - color[0]) * t),
    Math.round(color[1] + (target[1] - color[1]) * t),
    Math.round(color[2] + (target[2] - color[2]) * t),
    255,
  ];
}

/**
 * Gathers the roofscapes of many buildings into flat, layer-ready arrays,
 * tinting each piece from the building it stands on.
 */
export function collectRoofPieces(
  buildings: Building[],
  colorFor: (b: Building) => RGBA,
  tankColor: RGBA,
): RoofPieces {
  const pieces: RoofPieces = { parapets: [], boxes: [], tanks: [], posts: [] };
  for (const building of buildings) {
    const roof = computeRoofscape(building);
    const base = colorFor(building);
    // The parapet catches the sky and reads a touch lighter than the wall
    // below it; plant sits in its own shade.
    const parapetColor = shade(base, 1.08);
    const plantColor = shade(base, 0.82);
    // A timber tank is genuinely a different material from the tower, but it
    // is pulled most of the way back toward the building so it never becomes
    // a second accent colour on the skyline.
    const tank = towards(plantColor, tankColor, 0.55);

    if (roof.parapet) pieces.parapets.push({ ...roof.parapet, color: parapetColor });
    for (const s of roof.setbacks) pieces.parapets.push({ ...s, color: parapetColor });
    for (const b of roof.bulkheads) pieces.boxes.push({ ...b, color: plantColor });
    for (const t of roof.tanks) pieces.tanks.push({ ...t, color: tank });
    for (const p of roof.posts) pieces.posts.push({ ...p, color: plantColor });
  }
  return pieces;
}

/** Which cylinder bucket a radius belongs to, and that bucket's lower bound. */
function bucketFor(radiusM: number): number {
  for (let i = 0; i < CYLINDER_BUCKETS.length; i++) {
    if (radiusM <= CYLINDER_BUCKETS[i].maxR) return i;
  }
  return CYLINDER_BUCKETS.length - 1;
}

export interface RoofLayerOptions {
  /** Buildings that carry availability. */
  buildings: Building[];
  /**
   * The fill each of those buildings is drawn in, so its roof furniture is
   * the same building rather than a grey object standing on it.
   */
  colorFor: (b: Building) => RGBA;
  /** The surrounding grey city, already limited and sorted. */
  context?: Building[];
  theme: MapTheme;
  zoom: number;
  /** Distance haze, so roofs recede with the towers they stand on. */
  haze?: LayerExtension<unknown>;
  /** The reduced haze the data-carrying buildings take. */
  subjectHaze?: LayerExtension<unknown>;
}

function cylinderLayers(
  idPrefix: string,
  data: Tinted<RoofCylinder>[],
  theme: MapTheme,
  sides: number,
  material: typeof ROOF_MATERIAL,
  fade: object,
): Layer[] {
  const layers: Layer[] = [];
  CYLINDER_BUCKETS.forEach((bucket, i) => {
    const group = data.filter((c) => bucketFor(c.radiusM) === i);
    if (group.length === 0) return;
    // ColumnLayer takes one radius for the whole layer rather than an
    // accessor, so each bucket draws at its own members' mean radius.
    const radius = group.reduce((sum, c) => sum + c.radiusM, 0) / group.length;
    layers.push(
      new ColumnLayer<Tinted<RoofCylinder>>({
        id: `${idPrefix}-${bucket.key}`,
        ...fade,
        data: group,
        pickable: false,
        diskResolution: sides,
        extruded: true,
        radiusUnits: 'meters',
        radius,
        getPosition: (d) => [d.center[0], d.center[1], d.baseFt * FT_TO_M],
        getElevation: (d) => d.heightFt * FT_TO_M,
        getFillColor: (d) => d.color,
        material,
        updateTriggers: { getFillColor: [theme, group.length], getPosition: [group.length] },
      }),
    );
  });
  return layers;
}

function pieceLayers(
  idPrefix: string,
  pieces: RoofPieces,
  theme: MapTheme,
  material: typeof ROOF_MATERIAL,
  fade: object,
): Layer[] {
  const layers: Layer[] = [];

  if (pieces.parapets.length > 0) {
    layers.push(
      new PolygonLayer<Tinted<ParapetBand>>({
        id: `${idPrefix}-parapets`,
        ...fade,
        data: pieces.parapets,
        extruded: true,
        filled: true,
        stroked: false,
        wireframe: false,
        pickable: false,
        material,
        // Outer ring plus an inner ring, so this is a wall standing on the
        // roof edge rather than a lid laid over the whole roof.
        getPolygon: (d) =>
          d.rings.map((ring) =>
            ring.map(([lon, lat]) => [lon, lat, d.baseFt * FT_TO_M] as [number, number, number]),
          ),
        getElevation: (d) => d.heightFt * FT_TO_M,
        getFillColor: (d) => d.color,
        updateTriggers: {
          getFillColor: [theme, pieces.parapets.length],
          getPolygon: [pieces.parapets.length],
          getElevation: [pieces.parapets.length],
        },
      }),
    );
  }

  if (pieces.boxes.length > 0) {
    layers.push(
      new PolygonLayer<Tinted<RoofBox>>({
        id: `${idPrefix}-bulkheads`,
        ...fade,
        data: pieces.boxes,
        extruded: true,
        filled: true,
        stroked: false,
        wireframe: false,
        pickable: false,
        material,
        getPolygon: (d) =>
          d.ring.map(([lon, lat]) => [lon, lat, d.baseFt * FT_TO_M] as [number, number, number]),
        getElevation: (d) => d.heightFt * FT_TO_M,
        getFillColor: (d) => d.color,
        updateTriggers: {
          getFillColor: [theme, pieces.boxes.length],
          getPolygon: [pieces.boxes.length],
          getElevation: [pieces.boxes.length],
        },
      }),
    );
  }

  // Frames and masts before the tanks they carry, so a tank always draws over
  // the legs underneath it.
  layers.push(
    ...cylinderLayers(`${idPrefix}-posts`, pieces.posts, theme, 6, material, fade),
    ...cylinderLayers(`${idPrefix}-tanks`, pieces.tanks, theme, 10, material, fade),
  );

  return layers;
}

export function buildRoofLayers(opts: RoofLayerOptions): Layer[] {
  const { buildings, colorFor, context = [], theme, zoom, haze, subjectHaze } = opts;
  if (zoom < ROOF_ZOOM) return [];

  const palette = themeColors(theme);
  const layers: Layer[] = [];

  if (buildings.length > 0) {
    layers.push(
      ...pieceLayers(
        'roofs',
        collectRoofPieces(buildings, colorFor, palette.waterTank),
        theme,
        ROOF_MATERIAL,
        subjectHaze ? { extensions: [subjectHaze] } : {},
      ),
    );
  }

  if (zoom >= CONTEXT_ROOF_ZOOM && context.length > 0) {
    layers.push(
      ...pieceLayers(
        'roofs-context',
        collectRoofPieces(context, () => palette.cityContext, palette.cityContext),
        theme,
        CONTEXT_ROOF_MATERIAL,
        haze ? { extensions: [haze] } : {},
      ),
    );
  }

  return layers;
}
