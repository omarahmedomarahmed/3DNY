import { ColumnLayer, PathLayer, PolygonLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, LayerExtension } from '@deck.gl/core';
import { FT_TO_M, insetRing } from '@/lib/floor-bands';
import {
  buildRoadIndex,
  layoutStreetNames,
  nearestRoadAngle,
  type ParkPolygon,
  type RoadSegment,
  type StreetscapeResult,
  type StreetNameLabel,
  type EntranceKind,
  type StreetTree,
  type SubwayEntrance,
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
  /** Individual street trees. Below this a canopy is smaller than a pixel. */
  trees: 15.2,
  /** Painted street names on avenues and streets. */
  names: 15.0,
  /** Painted names on the narrowest streets. */
  allNames: 15.8,
  /**
   * Subway entrances. A stair head is about 4.6m long, which at zoom 16 is
   * two pixels — drawn, paid for, and indistinguishable from grit. They only
   * start to read as objects around here.
   */
  entrances: 16.6,
} as const;

/**
 * Trees, bucketed by canopy radius.
 *
 * ColumnLayer takes ONE radius for the whole layer rather than an accessor,
 * so varying canopy size means one layer per size — three buckets is enough
 * for a street to stop looking like a row of identical stamps, and few enough
 * to stay cheap. Trunk diameter in inches stands in for canopy spread.
 */
const TREE_BUCKETS: { key: string; maxDbh: number; canopyM: number; heightM: number }[] = [
  { key: 'small', maxDbh: 8, canopyM: 2.2, heightM: 5 },
  { key: 'medium', maxDbh: 18, canopyM: 3.4, heightM: 7 },
  { key: 'large', maxDbh: Infinity, canopyM: 4.8, heightM: 9.5 },
];

/**
 * Foliage shading, and a warning about `specularColor`.
 *
 * A white specular colour at shininess 1 is an extremely broad lobe: it lays
 * a near-white wash across the entire surface and drives any dark fill pale.
 * Trees given the city-context material came out as bright blobs lining every
 * street on the dark map — the second-loudest thing on screen after the
 * availability bands, which is precisely the regression this project is not
 * allowed to ship. A near-black specular keeps the modelling that makes a
 * canopy read as round, without the wash.
 */
const FOLIAGE_MATERIAL = {
  ambient: 0.55,
  diffuse: 0.5,
  shininess: 16,
  specularColor: [14, 20, 16] as [number, number, number],
};

/** The lower bound of a bucket — the previous bucket's ceiling. */
function previousMax(bucket: (typeof TREE_BUCKETS)[number]): number {
  const i = TREE_BUCKETS.indexOf(bucket);
  return i <= 0 ? -Infinity : TREE_BUCKETS[i - 1].maxDbh;
}

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
  /** The three water bands, shore outward to channel centre. */
  waterEdge: 0.02,
  waterShallow: 0.03,
  waterDeep: 0.04,
  park: 0.05,
  sidewalk: 0.07,
  casing: 0.09,
  road: 0.12,
  name: 0.16,
} as const;

/** Where flat decoration drawn elsewhere must sit to clear the ground stack. */
export const GROUND_TOP_Z = 0.2;

/**
 * Water, as three nested bands running bright at the bank to dark at the
 * channel centre.
 *
 * A river drawn as one flat fill reads as coloured paper. Nesting the shore
 * shelf inside it reads as depth for the cost of two extra polygons and no
 * shader at all — the same trick the contact shadows use to stand in for a
 * shadow pass. Drawn largest first, so each darker band sits inside the last.
 */
const WATER_BANDS: { z: number; inset: number; tone: 'edge' | 'shallow' | 'deep' }[] = [
  { z: GROUND_Z.waterEdge, inset: 1, tone: 'edge' },
  { z: GROUND_Z.waterShallow, inset: 0.9965, tone: 'shallow' },
  { z: GROUND_Z.waterDeep, inset: 0.992, tone: 'deep' },
];

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

/**
 * Manhattan's street grid runs about 29° east of true north, which is 61°
 * measured CCW from east. Used only when an entrance has no street near enough
 * to take an orientation from — a plausible angle beats an arbitrary one.
 */
const MANHATTAN_GRID_ANGLE = 61;

/** Height of the post the entrance globe sits on, in metres. */
const GLOBE_POST_M = 2.4;

/** One entrance enclosure, ready to extrude. */
interface EntranceBox {
  ring: [number, number][];
  heightM: number;
  kind: EntranceKind;
}

/**
 * What each kind of entrance looks like. Dimensions are close to the real
 * thing: a stair head enclosure is about four metres along the pavement and
 * waist-high; an elevator headhouse is a genuine little building.
 */
const ENTRANCE_SPEC: Record<
  EntranceKind,
  { lengthM: number; widthM: number; heightM: number; globe: boolean }
> = {
  0: { lengthM: 4.6, widthM: 2.4, heightM: 1.15, globe: true },
  1: { lengthM: 2.6, widthM: 2.6, heightM: 3.2, globe: false },
  2: { lengthM: 4.2, widthM: 2.2, heightM: 1.15, globe: true },
  // Doors, ramps and easements through building lobbies: no street furniture
  // of their own, so a low kerb-height marker and nothing more.
  3: { lengthM: 2.2, widthM: 1.6, heightM: 0.5, globe: false },
};

const ENTRANCE_MATERIAL = {
  ambient: 0.6,
  diffuse: 0.55,
  shininess: 10,
  specularColor: [30, 36, 48] as [number, number, number],
};

/**
 * A rectangle centred on a point, `lengthM` along `angleDeg` and `widthM`
 * across it. Angles are CCW from east, matching `segmentAngle`.
 */
export function orientedRect(
  center: [number, number],
  lengthM: number,
  widthM: number,
  angleDeg: number,
): [number, number][] {
  const [lon, lat] = center;
  const mLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const rad = (angleDeg * Math.PI) / 180;
  // Along-street and across-street unit vectors, in metres.
  const ax = Math.cos(rad);
  const ay = Math.sin(rad);
  const halfL = lengthM / 2;
  const halfW = widthM / 2;

  const corner = (sl: number, sw: number): [number, number] => {
    const dx = ax * halfL * sl - ay * halfW * sw;
    const dy = ay * halfL * sl + ax * halfW * sw;
    return [lon + dx / mLon, lat + dy / 111_320];
  };

  const a = corner(-1, -1);
  return [a, corner(1, -1), corner(1, 1), corner(-1, 1), a];
}

export interface GroundLayerOptions {
  streetscape: StreetscapeResult;
  theme: MapTheme;
  zoom: number;
  /**
   * Distance haze. The ground takes it at full strength: a street grid running
   * to a hard edge at the horizon is the single thing that most gives away
   * that a city model is a model.
   */
  haze?: LayerExtension<unknown>;
}

export function buildGroundLayers(opts: GroundLayerOptions): Layer[] {
  const { streetscape, theme, zoom, haze } = opts;
  const fade = haze ? { extensions: [haze] } : {};
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
          ...fade,
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
    const waterTone = {
      edge: palette.waterEdge,
      shallow: palette.waterShallow,
      deep: palette.water,
    };
    for (const band of WATER_BANDS) {
      layers.push(
        new PolygonLayer<WaterPolygon>({
          id: `ground-water-${band.tone}`,
          ...fade,
          data: streetscape.water,
          extruded: false,
          filled: true,
          stroked: false,
          pickable: false,
          material: false,
          getPolygon: (d) =>
            d.rings.map((ring) =>
              atZ(band.inset === 1 ? ring : insetRing(ring, band.inset), band.z),
            ),
          getFillColor: waterTone[band.tone],
          updateTriggers: { getFillColor: [theme] },
        }),
      );
    }
  }

  // --- Parks. Under the streets, because a path through Central Park is still
  // a street and should draw over the lawn.
  if (streetscape.parks.length > 0) {
    const parkTone = [palette.park, palette.parkPlaza, palette.parkCourt];
    layers.push(
      new PolygonLayer<ParkPolygon>({
        id: 'ground-parks',
          ...fade,
        data: streetscape.parks,
        extruded: false,
        filled: true,
        stroked: false,
        pickable: false,
        material: false,
        getPolygon: (d) => d.rings.map((ring) => atZ(ring, GROUND_Z.park)),
        getFillColor: (d) => parkTone[d.t] ?? palette.park,
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
          ...fade,
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
          ...fade,
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
          ...fade,
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

  // --- Street trees. Real planting positions, with canopy size from the
  // census' trunk diameter, so a block of mature London planes reads
  // differently from a row of new saplings. Never pickable and never lit
  // brightly: greenery is what stops a city model looking like a circuit
  // board, and the moment it competes with a Goldenrod band it has failed.
  if (zoom >= GROUND_LOD.trees && streetscape.trees.length > 0) {
    for (const bucket of TREE_BUCKETS) {
      const data = streetscape.trees.filter(
        (t) => t.d <= bucket.maxDbh && t.d > previousMax(bucket),
      );
      if (data.length === 0) continue;

      layers.push(
        new ColumnLayer<StreetTree>({
          id: `ground-tree-trunks-${bucket.key}`,
          ...fade,
          data,
          pickable: false,
          diskResolution: 5,
          extruded: true,
          radiusUnits: 'meters',
          radius: Math.max(0.2, bucket.canopyM * 0.12),
          getPosition: (d) => d.p,
          getElevation: bucket.heightM * 0.55,
          getFillColor: palette.trunk,
          material: FOLIAGE_MATERIAL,
          updateTriggers: { getFillColor: [theme] },
        }),
        new ColumnLayer<StreetTree>({
          id: `ground-tree-canopies-${bucket.key}`,
          ...fade,
          data,
          pickable: false,
          // Few enough sides to read as foliage rather than as a machined
          // cylinder, and cheap enough for a few thousand of them.
          diskResolution: 7,
          extruded: true,
          radiusUnits: 'meters',
          radius: bucket.canopyM,
          getPosition: (d) => [d.p[0], d.p[1], bucket.heightM * 0.55],
          getElevation: bucket.heightM * 0.45,
          getFillColor: palette.canopy,
          material: FOLIAGE_MATERIAL,
          updateTriggers: { getFillColor: [theme] },
        }),
      );
    }
  }

  // --- Subway entrances. The actual holes in the pavement from the MTA's own
  // inventory, not a station centroid: a station is eight stair heads spread
  // over two blocks, and which corner you surface on is a real part of whether
  // a building is a five-minute walk or a nine-minute one.
  //
  // Each stair is a low enclosure squared to the street it stands on, with the
  // green globe lamp beside it that has meant "open" in New York since the
  // eighties. Elevators get a taller headhouse and no globe.
  if (zoom >= GROUND_LOD.entrances && streetscape.entrances.length > 0) {
    const index = buildRoadIndex(streetscape.roads);
    const enclosures: EntranceBox[] = [];
    const globes: SubwayEntrance[] = [];

    for (const entrance of streetscape.entrances) {
      // No nearby street means no plausible orientation; the grid's own
      // prevailing angle is a better guess than an arbitrary one.
      const angle = nearestRoadAngle(entrance.p, index) ?? MANHATTAN_GRID_ANGLE;
      const spec = ENTRANCE_SPEC[entrance.k];
      enclosures.push({
        ring: orientedRect(entrance.p, spec.lengthM, spec.widthM, angle),
        heightM: spec.heightM,
        kind: entrance.k,
      });
      if (spec.globe) globes.push(entrance);
    }

    layers.push(
      new PolygonLayer<EntranceBox>({
        id: 'ground-subway-entrances',
        ...fade,
        data: enclosures,
        extruded: true,
        filled: true,
        stroked: false,
        wireframe: false,
        pickable: false,
        material: ENTRANCE_MATERIAL,
        getPolygon: (d) => atZ(d.ring, GROUND_TOP_Z),
        getElevation: (d) => d.heightM,
        getFillColor: (d) => (d.kind === 1 ? palette.entranceElevator : palette.entranceStair),
        updateTriggers: {
          getFillColor: [theme, enclosures.length],
          getPolygon: [enclosures.length],
          getElevation: [enclosures.length],
        },
      }),
    );

    if (globes.length > 0) {
      layers.push(
        new ColumnLayer<SubwayEntrance>({
          id: 'ground-entrance-posts',
          ...fade,
          data: globes,
          pickable: false,
          diskResolution: 6,
          extruded: true,
          radiusUnits: 'meters',
          radius: 0.16,
          getPosition: (d) => [d.p[0], d.p[1], GROUND_TOP_Z],
          getElevation: GLOBE_POST_M,
          getFillColor: palette.entranceStair,
          material: ENTRANCE_MATERIAL,
          updateTriggers: { getFillColor: [theme], getPosition: [globes.length] },
        }),
        new ColumnLayer<SubwayEntrance>({
          id: 'ground-entrance-globes',
          // The globe deliberately does NOT take distance haze. It is small,
          // and the point of it is that you can find the subway across a
          // frame; fading it into the air removes the only thing it does.
          data: globes,
          pickable: false,
          diskResolution: 8,
          extruded: true,
          radiusUnits: 'meters',
          radius: 0.42,
          getPosition: (d) => [d.p[0], d.p[1], GROUND_TOP_Z + GLOBE_POST_M],
          getElevation: 0.8,
          getFillColor: palette.entranceGlobe,
          material: ENTRANCE_MATERIAL,
          updateTriggers: { getFillColor: [theme], getPosition: [globes.length] },
        }),
      );
    }
  }

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
          ...fade,
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
