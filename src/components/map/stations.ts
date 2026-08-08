import { ColumnLayer, PolygonLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, LayerExtension, PickingInfo } from '@deck.gl/core';
import { nearestRoadAngle, type RoadIndex } from '@/lib/streetscape';
import { MODE_LABEL, type TransitStop } from '@/lib/transit';
import { orientedRect } from './ground';
import { TRANSIT_COLORS, themeColors, type MapTheme, type RGBA } from './colors';
import type { MapPoint } from './layers';

/**
 * Stations as buildings, not as pins.
 *
 * A transit stop used to be a post with a coloured disc on top — a map pin,
 * standing in a city made of real geometry, which is exactly where a pin looks
 * most like a placeholder. A station is a structure you walk into: a kiosk on
 * the pavement with a canopy over the stair and a sign you can read from the
 * far corner.
 *
 * So the marker is modelled: a headhouse squared to the street it stands on, a
 * canopy slab, and a sign pylon carrying the mode colour with the station
 * roundel on top. Mode still reads at a glance — that is what the colour is
 * for and it is what decides a lease — but it now reads off a thing that
 * belongs in the scene.
 *
 * Bus stops keep the small post they had. There are hundreds of them in a
 * viewport, they are texture rather than subject, and a bus shelter modelled
 * four hundred times over is clutter and cost with nothing gained.
 */

/** Above this, a modelled station is worth the geometry. */
export const STATION_MODEL_ZOOM = 14.6;

/** Above this, stations carry their name on a plate. */
export const STATION_LABEL_ZOOM = 14.2;

/** Modes that get a modelled headhouse rather than a post. */
const MODELLED = new Set(['subway', 'rail', 'path', 'ferry', 'tram']);

/** Manhattan's prevailing grid angle, used when no street is near enough. */
const GRID_ANGLE = 61;

/** Headhouse dimensions, in metres. Close to a real NYC stair kiosk. */
const KIOSK = { length: 8.5, width: 5.2, height: 3.6 };
/** The canopy oversails the kiosk, which is what makes it read as shelter. */
const CANOPY = { length: 10.4, width: 6.8, thickness: 0.55 };
/** The sign pylon beside the entrance. */
const PYLON = { size: 1.1, height: 6.4 };

const STATION_MATERIAL = {
  ambient: 0.6,
  diffuse: 0.58,
  shininess: 12,
  specularColor: [36, 42, 56] as [number, number, number],
};

interface StationPiece {
  ring: [number, number][];
  baseM: number;
  heightM: number;
  color: RGBA;
}

interface StationSign {
  position: [number, number];
  color: RGBA;
}

interface StationLabel {
  position: [number, number, number];
  text: string;
}

/**
 * One station per name per place.
 *
 * A subway station is several rows in the source — one per platform or
 * complex member — all within a few metres of each other. Modelling each of
 * them stacks four kiosks on one corner; labelling each of them stacks four
 * identical name plates. Rounding the position to roughly a block and keying
 * on the name collapses them to the one station a broker means.
 */
export function dedupeStations(stops: TransitStop[]): TransitStop[] {
  const seen = new Map<string, TransitStop>();
  for (const stop of stops) {
    const key = `${stop.name}|${stop.lon.toFixed(3)},${stop.lat.toFixed(3)}`;
    const existing = seen.get(key);
    // Keep the one with the most routes — that is the main entrance of a
    // complex rather than a single-line platform edge.
    if (!existing || stop.routes.length > existing.routes.length) seen.set(key, stop);
  }
  return [...seen.values()];
}

/** Station name, plus the routes when they are short enough to be useful. */
export function stationLabelText(stop: TransitStop): string {
  const carriesRoutes = stop.mode === 'subway' || stop.mode === 'path';
  const routes =
    carriesRoutes && stop.routes.length > 0 ? stop.routes.slice(0, 6).join(' ') : MODE_LABEL[stop.mode];
  return `${stop.name}\n${routes}`;
}

export interface StationLayerOptions {
  stops: TransitStop[];
  theme: MapTheme;
  zoom: number;
  /** Used to square each headhouse to the street it stands on. */
  roadIndex?: RoadIndex | null;
  haze?: LayerExtension<unknown>;
  onClick?: (stop: TransitStop, at: MapPoint) => void;
}

export function buildStationLayers(opts: StationLayerOptions): Layer[] {
  const { stops, theme, zoom, roadIndex = null, haze, onClick } = opts;
  const palette = themeColors(theme);
  const fade = haze ? { extensions: [haze] } : {};
  const layers: Layer[] = [];
  if (stops.length === 0) return layers;

  const modelled = dedupeStations(stops.filter((s) => MODELLED.has(s.mode)));
  const posts = stops.filter((s) => !MODELLED.has(s.mode));

  // --- Bus and anything else: the small post, unchanged. Texture, not subject.
  if (posts.length > 0) {
    layers.push(
      new ColumnLayer<TransitStop>({
        id: 'transit-posts',
        ...fade,
        data: posts,
        pickable: true,
        diskResolution: 6,
        extruded: true,
        radiusUnits: 'meters',
        radius: 1.6,
        getPosition: (d) => [d.lon, d.lat],
        getElevation: 3.6,
        getFillColor: palette.transitMast,
        material: STATION_MATERIAL,
        onClick: (info: PickingInfo<TransitStop>) => {
          if (!info.object || !onClick) return false;
          onClick(info.object, { x: info.x, y: info.y });
          return true;
        },
        updateTriggers: { getFillColor: [theme] },
      }),
      new ColumnLayer<TransitStop>({
        id: 'transit-post-heads',
        ...fade,
        data: posts,
        pickable: false,
        diskResolution: 4,
        extruded: true,
        radiusUnits: 'meters',
        radius: 3.2,
        getPosition: (d) => [d.lon, d.lat, 3.6],
        getElevation: 1.1,
        getFillColor: (d) => TRANSIT_COLORS[d.mode] ?? TRANSIT_COLORS.bus,
        material: STATION_MATERIAL,
        updateTriggers: { getFillColor: [theme] },
      }),
    );
  }

  if (modelled.length > 0 && zoom >= STATION_MODEL_ZOOM) {
    const kiosks: StationPiece[] = [];
    const canopies: StationPiece[] = [];
    const pylons: StationPiece[] = [];
    const roundels: StationSign[] = [];

    for (const stop of modelled) {
      const at: [number, number] = [stop.lon, stop.lat];
      const angle = (roadIndex ? nearestRoadAngle(at, roadIndex) : null) ?? GRID_ANGLE;
      const color = TRANSIT_COLORS[stop.mode] ?? TRANSIT_COLORS.bus;

      kiosks.push({
        ring: orientedRect(at, KIOSK.length, KIOSK.width, angle),
        baseM: 0,
        heightM: KIOSK.height,
        color: palette.stationWall,
      });
      canopies.push({
        ring: orientedRect(at, CANOPY.length, CANOPY.width, angle),
        baseM: KIOSK.height,
        heightM: CANOPY.thickness,
        color: palette.stationRoof,
      });

      // The sign stands just off one end of the kiosk, on the pavement, the
      // way a real station pylon does.
      const signAt = offsetAlong(at, angle, KIOSK.length / 2 + 1.4);
      pylons.push({
        ring: orientedRect(signAt, PYLON.size, PYLON.size, angle),
        baseM: 0,
        heightM: PYLON.height,
        color,
      });
      roundels.push({ position: signAt, color });
    }

    const piece = (id: string, data: StationPiece[]) =>
      new PolygonLayer<StationPiece>({
        id,
        ...fade,
        data,
        extruded: true,
        filled: true,
        stroked: false,
        wireframe: false,
        pickable: false,
        material: STATION_MATERIAL,
        getPolygon: (d) =>
          d.ring.map(([lon, lat]) => [lon, lat, d.baseM] as [number, number, number]),
        getElevation: (d) => d.heightM,
        getFillColor: (d) => d.color,
        updateTriggers: {
          getFillColor: [theme, data.length],
          getPolygon: [data.length],
          getElevation: [data.length],
        },
      });

    layers.push(piece('station-kiosks', kiosks), piece('station-canopies', canopies));

    // The pylon is the click target: it is the tallest part, it carries the
    // mode colour, and it is what a pointer naturally goes for.
    layers.push(
      new PolygonLayer<StationPiece>({
        id: 'station-pylons',
        ...fade,
        data: pylons,
        extruded: true,
        filled: true,
        stroked: false,
        pickable: true,
        material: STATION_MATERIAL,
        getPolygon: (d) =>
          d.ring.map(([lon, lat]) => [lon, lat, d.baseM] as [number, number, number]),
        getElevation: (d) => d.heightM,
        getFillColor: (d) => d.color,
        onClick: (info: PickingInfo<StationPiece>) => {
          if (info.index < 0 || !onClick) return false;
          const stop = modelled[info.index];
          if (!stop) return false;
          onClick(stop, { x: info.x, y: info.y });
          return true;
        },
        updateTriggers: {
          getFillColor: [theme, pylons.length],
          getPolygon: [pylons.length],
          getElevation: [pylons.length],
        },
      }),
      // The roundel on top of the pylon — the disc that says "station" from
      // across a street.
      new ColumnLayer<StationSign>({
        id: 'station-roundels',
        data: roundels,
        pickable: false,
        diskResolution: 12,
        extruded: true,
        radiusUnits: 'meters',
        radius: 1.5,
        getPosition: (d) => [d.position[0], d.position[1], PYLON.height],
        getElevation: 0.5,
        getFillColor: (d) => d.color,
        material: STATION_MATERIAL,
        updateTriggers: { getFillColor: [theme, roundels.length], getPosition: [roundels.length] },
      }),
    );
  }

  // --- The name, on a plate above the station, exactly as buildings carry
  // theirs. Knowing a stop is a subway is not the same as knowing it is Grand
  // Central, and the second one is what a tenant asks about.
  if (modelled.length > 0 && zoom >= STATION_LABEL_ZOOM) {
    const labels: StationLabel[] = modelled.map((stop) => ({
      position: [stop.lon, stop.lat, PYLON.height + 2.5],
      text: stationLabelText(stop),
    }));

    layers.push(
      new TextLayer<StationLabel>({
        id: 'station-labels',
        data: labels,
        pickable: false,
        billboard: true,
        background: true,
        getPosition: (d) => d.position,
        getText: (d) => d.text,
        getSize: 11,
        sizeUnits: 'pixels',
        lineHeight: 1.3,
        characterSet: 'auto',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
        fontWeight: 700,
        getColor: palette.labelText,
        getBackgroundColor: palette.labelBg,
        getBorderColor: palette.labelBorder,
        getBorderWidth: 1,
        backgroundPadding: [6, 3, 6, 3],
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'bottom',
        getPixelOffset: [0, -6],
        // Never swallowed by the tower it stands next to, same as the
        // building name-plates.
        parameters: { depthCompare: 'always' },
        updateTriggers: {
          getText: [labels.length],
          getPosition: [labels.length],
          getColor: [theme],
          getBackgroundColor: [theme],
          getBorderColor: [theme],
        },
      }),
    );
  }

  return layers;
}

/** Moves a point `meters` along `angleDeg`, measured CCW from east. */
function offsetAlong(
  point: [number, number],
  angleDeg: number,
  meters: number,
): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  const mLon = 111_320 * Math.cos((point[1] * Math.PI) / 180);
  return [point[0] + (Math.cos(rad) * meters) / mLon, point[1] + (Math.sin(rad) * meters) / 111_320];
}
