import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { circle as turfCircle } from '@turf/turf';
import {
  FT_TO_M,
  buildingHeightFt,
  buildingRing,
  computeFloorBands,
  computeFloorLines,
} from '@/lib/floor-bands';
import type { BuildingWithSpaces, ColorMode, FloorBand } from '@/types';
import type { ContextBuilding } from '@/lib/city-context';
import {
  MODE_LABEL,
  layoutWalkLabels,
  nearestStops,
  type TransitStop,
  type WalkLabel,
} from '@/lib/transit';
import { MULLIONS_DARK, MULLIONS_LIGHT } from './mullions';
import {
  DIMMED_COLOR,
  FLOOR_BAND_COLOR,
  FLOOR_BAND_PARTIAL_COLOR,
  HOVER_COLOR,
  SELECTED_COLOR,
  TRANSIT_COLORS,
  WALK_LABEL_BG,
  WALK_LABEL_TEXT,
  WALK_LINE_COLOR,
  colorForBuilding,
  themeColors,
} from './colors';
import type { MapTheme, RGBA } from './colors';

/**
 * Zoom at which floor bands appear for every building, not just the selection.
 * Low enough that the stack of floors is part of what a building looks like,
 * rather than something you have to go looking for.
 */
export const BAND_ZOOM_THRESHOLD = 14.5;

/**
 * Zoom at which each building gets a name-plate. Deliberately half a step
 * below the band threshold: the labels arrive first and tell you *what* you're
 * looking at, then the bands arrive and tell you *where* in the tower.
 */
export const LABEL_ZOOM_THRESHOLD = 15.6;

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
  /**
   * True while Google's photorealistic mesh is the ground truth. The grey
   * massing is redundant then, and the layers that carry data have to draw
   * without depth testing or the mesh swallows them.
   */
  photoreal?: boolean;
  /** Google's tileset layer, already constructed. Drawn under everything. */
  photorealLayer?: Layer | null;
  /**
   * Draw the buildings with nothing available — the surrounding city and the
   * ones the filters excluded. Off gives the clean map: only what is being
   * shown, nothing else on screen to explain.
   */
  showContext?: boolean;
  /** Dark or light basemap. Only the recessive colours change with it. */
  theme?: MapTheme;
  /** Transit stops in view. Empty unless the transit layer is switched on. */
  transitStops?: TransitStop[];
  /** Walk lines are drawn from this building to its nearest stops. */
  transitOrigin?: [number, number] | null;
  onTransitClick?: (stop: TransitStop, at: MapPoint) => void;
  /** `at` is where the pointer was, so the popup can anchor to the click. */
  onBuildingClick: (buildingId: string, at: MapPoint) => void;
  onSpaceClick: (spaceId: string, buildingId: string, at: MapPoint) => void;
  onHover: (buildingId: string | null) => void;
}

/**
 * Opts a layer out of casting shadows.
 *
 * Decoration that stands proud of a wall — the floor plates, the availability
 * collar — throws a stripe of shadow across the facade behind it, which reads
 * as another building's shadow falling on ours. `shadowEnabled` is honoured by
 * deck.gl's shadow pass but missing from its published prop types, so it is
 * spread in as an untyped object rather than suppressed at each call site.
 */
const NO_SHADOW = { shadowEnabled: false } as {};

/** A polygon ring carrying a fixed z, so deck.gl extrudes from that base. */
type Ring3 = [number, number, number][];

/** One floor plate line on a facade, ready to extrude. */
interface FloorLineDatum {
  ring: Ring3;
  heightM: number;
}

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
    photoreal = false,
    photorealLayer = null,
    showContext = false,
    theme = 'dark',
    transitStops,
    transitOrigin = null,
    onTransitClick,
    onBuildingClick,
    onSpaceClick,
    onHover,
  } = opts;

  const filteredIds = new Set(filtered.map((b) => b.id));
  const palette = themeColors(theme);
  const layers: Layer[] = [];

  // The photoreal mesh is the ground itself — first in, so everything with
  // data draws over it.
  if (photorealLayer) layers.push(photorealLayer);

  // --- The city itself. Drawn first so everything with data sits on top of it,
  // and never pickable: this is scenery, and a click that selects a random
  // warehouse in the middle of a meeting is worse than no scenery at all.
  //
  // BINs we already render are skipped, otherwise the tower carrying the data
  // would be buried inside an identical gray copy of itself.
  if (showContext && !photoreal && cityContext && cityContext.length > 0) {
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
            ambient: 0.62,
            diffuse: 0.55,
            shininess: 1,
            specularColor: [255, 255, 255],
          },
          getPolygon: (c) => c.r,
          getElevation: (c) => c.h * FT_TO_M,
          getFillColor: palette.cityContext,
        }),
      );
    }
  }

  // --- Context: everything the filters excluded, kept as dim massing so the
  // map never empties out mid-meeting.
  const context =
    photoreal || !showContext
      ? []
      : buildings.filter((b) => !filteredIds.has(b.id) && buildingRing(b) !== null);

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
        getFillColor: palette.dimmed,
        updateTriggers: {
          getFillColor: [filtered.length, theme],
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
      // Against photogrammetry the building already exists in full detail, so
      // re-extruding our own box on top of it would only z-fight with the real
      // facade. The footprint stays as a coloured plate at street level: it
      // keeps the colour-by-rent reading, keeps the building clickable, and
      // sits where a real shadow would.
      extruded: !photoreal,
      filled: true,
      stroked: photoreal,
      getLineColor: palette.labelBorder,
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      wireframe: false,
      pickable: true,
      autoHighlight: false,
      // Walls only, and only while they are walls: in photorealistic mode the
      // footprint is a flat plate with no side faces to draw them on.
      extensions: photoreal ? [] : [theme === 'dark' ? MULLIONS_DARK : MULLIONS_LIGHT],
      // Tuned for a real sun rather than a flat ambient wash: enough diffuse
      // that the lit and shaded walls of a tower differ plainly as the camera
      // orbits, and a small specular term so the highlight travels across the
      // facade with the point of view rather than sitting still.
      material: { ambient: 0.62, diffuse: 0.6, shininess: 12, specularColor: [38, 44, 58] },
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
        getFillColor: [colorMode, selectedBuildingId, hoveredBuildingId, active.length, theme],
        getElevation: [active.length, photoreal],
      },
    }),
  );

  // --- The facade skin: every floor plate of every building on screen, drawn
  // as a thin ring one shade off the wall. This is what makes an extrusion
  // read as a building rather than a coloured block — a stack of floors you
  // can count, at the building's own derived floor height, so an availability
  // band lands exactly on the line for the floor the sheet named.
  //
  // Decorative and never pickable. It appears at the same zoom as the bands,
  // because below that the lines are closer together than a pixel.
  if (zoom >= BAND_ZOOM_THRESHOLD && !photoreal) {
    const lines: FloorLineDatum[] = [];
    // The plate thickness is a fixed fraction of a metre rather than of the
    // floor height: a slab reads the same on a 12ft floor and a 20ft one.
    const PLATE_M = 0.18;
    for (const building of active) {
      for (const line of computeFloorLines(building)) {
        lines.push({
          ring: ringWithZ(line.polygon, line.baseFt * FT_TO_M),
          heightM: PLATE_M,
        });
      }
    }

    if (lines.length > 0) {
      layers.push(
        new PolygonLayer<FloorLineDatum>({
          id: 'facade-floor-lines',
          data: lines,
          ...NO_SHADOW,
          extruded: true,
          filled: true,
          stroked: false,
          wireframe: false,
          pickable: false,
          // Unlit. A floor line is a gap between plates, and shading it would
          // make the stack shimmer as the camera orbits.
          material: false,
          getPolygon: (d) => d.ring,
          getElevation: (d) => d.heightM,
          getFillColor: palette.floorLine,
          updateTriggers: {
            getFillColor: [theme],
          },
        }),
      );
    }
  }

  // --- Floor bands: the selected tower always, everything else once the user
  // is zoomed in enough for the stripes to be legible.
  const showAllBands = zoom >= BAND_ZOOM_THRESHOLD;
  const bandSources = active.filter(
    (b) => showAllBands || b.id === selectedBuildingId,
  );

  const bands: BandDatum[] = [];
  for (const building of bandSources) {
    for (const band of computeFloorBands(building, building.spaces)) {
      // A part floor is drawn as a thinner stripe than a whole one, so the two
      // are distinguishable at a glance and not only by colour.
      const thickness = band.portion === 'partial' ? 0.55 : 0.92;
      const heightM = Math.max(0.5, (band.topFt - band.baseFt) * thickness * FT_TO_M);
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
        ...NO_SHADOW,
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
        // Photogrammetry is opaque, so a band drawn at its true position on the
        // 14th floor is inside the mesh and therefore invisible. Drawing it
        // without depth testing is the only way availability stays the loudest
        // thing on screen — the same trade already made for the name-plates.
        ...(photoreal ? { parameters: { depthCompare: 'always' as const } } : {}),
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
        getFillColor: palette.radiusFill,
        getLineColor: palette.radiusLine,
        getLineWidth: 3,
        lineWidthUnits: 'pixels',
        updateTriggers: {
          getPolygon: [radius.lon, radius.lat, radius.miles],
        },
      }),
    );
  }

  // --- Transit. Stops first, then the walk lines from the selected building,
  // then the minutes — each above the last so a number is never covered by the
  // dot it belongs to.
  if (transitStops && transitStops.length > 0) {
    layers.push(
      new ScatterplotLayer<TransitStop>({
        id: 'transit-stops',
        data: transitStops,
        pickable: true,
        radiusUnits: 'pixels',
        // Bus stops are twenty times as numerous as everything else, so they
        // are drawn small enough to read as texture until you look for them.
        getRadius: (d) => (d.mode === 'bus' ? 3.4 : 6.5),
        radiusMinPixels: 3,
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1.4,
        getLineColor: palette.labelBg,
        getPosition: (d) => [d.lon, d.lat],
        getFillColor: (d) => TRANSIT_COLORS[d.mode] ?? TRANSIT_COLORS.bus,
        // Sits flat on the ground plane, under the towers rather than through
        // them, which is where a station actually is.
        parameters: { depthCompare: 'always' },
        onClick: (info: PickingInfo<TransitStop>) => {
          if (!info.object || !onTransitClick) return false;
          onTransitClick(info.object, { x: info.x, y: info.y });
          return true;
        },
        updateTriggers: { getLineColor: [theme] },
      }),
    );

    if (transitOrigin) {
      const nearby = nearestStops(transitOrigin, transitStops, {
        limit: 5,
        maxMeters: 1000,
        perMode: 2,
      });

      // deck.gl has no dashed path without the style extension, so the dash is
      // the geometry: each line is cut into alternating drawn and skipped
      // pieces, sized in metres so the rhythm holds at any zoom.
      const dashes: { path: [number, number][] }[] = [];
      for (const stop of nearby) {
        const from = transitOrigin;
        const to: [number, number] = [stop.lon, stop.lat];
        const meters = Math.max(1, stop.meters);
        const dashM = 26;
        const steps = Math.max(2, Math.round(meters / dashM));
        for (let i = 0; i < steps; i += 2) {
          const t0 = i / steps;
          const t1 = Math.min(1, (i + 1) / steps);
          dashes.push({
            path: [
              [from[0] + (to[0] - from[0]) * t0, from[1] + (to[1] - from[1]) * t0],
              [from[0] + (to[0] - from[0]) * t1, from[1] + (to[1] - from[1]) * t1],
            ],
          });
        }
      }

      if (dashes.length > 0) {
        layers.push(
          new PathLayer<{ path: [number, number][] }>({
            id: 'transit-walk-lines',
            data: dashes,
            pickable: false,
            widthUnits: 'pixels',
            getWidth: 2.4,
            widthMinPixels: 2,
            capRounded: true,
            getPath: (d) => d.path,
            getColor: WALK_LINE_COLOR,
            parameters: { depthCompare: 'always' },
          }),
        );

        layers.push(
          new TextLayer<WalkLabel>({
            id: 'transit-walk-minutes',
            data: layoutWalkLabels(transitOrigin, nearby),
            pickable: false,
            billboard: true,
            background: true,
            // Positions are solved in layoutWalkLabels, which slides each pill
            // along its own line until none of them overlap.
            getPosition: (d) => d.position,
            // Short on purpose. A pill is a fixed pixel width whatever the
            // zoom, so when the nearby stops sit close together no arrangement
            // along their own lines can fit six wide labels — the only real
            // fix is a narrower label. Rail-type routes are short and worth
            // carrying ("4 5 6"); a bus stop's route list is not, and lives on
            // the card you get by clicking the stop.
            getText: ({ stop }) => {
              // Only subway and PATH: their routes are single letters and
              // numbers. Rail routes are words — "Metro-North LIRR" is wider
              // than the pill it has to fit in, and it is the mode label that
              // matters there anyway.
              const carriesRoutes = stop.mode === 'subway' || stop.mode === 'path';
              const tag =
                carriesRoutes && stop.routes.length
                  ? stop.routes.slice(0, 3).join(' ')
                  : MODE_LABEL[stop.mode];
              return `${stop.minutes} min · ${tag}`;
            },
            getSize: 12,
            sizeUnits: 'pixels',
            characterSet: 'auto',
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
            fontWeight: 700,
            getColor: WALK_LABEL_TEXT,
            getBackgroundColor: WALK_LABEL_BG,
            backgroundPadding: [7, 3, 7, 3],
            getTextAnchor: 'middle',
            getAlignmentBaseline: 'center',
            parameters: { depthCompare: 'always' },
            updateTriggers: {
              getText: [transitOrigin[0], transitOrigin[1], nearby.length],
              getPosition: [transitOrigin[0], transitOrigin[1]],
            },
          }),
        );
      }
    }
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
          getColor: palette.labelText,
          getBackgroundColor: palette.labelBg,
          getBorderColor: palette.labelBorder,
          getBorderWidth: 1,
          backgroundPadding: [7, 4, 7, 4],
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'bottom',
          getPixelOffset: [0, -8],
          parameters: { depthCompare: 'always' },
          updateTriggers: {
            getText: [colorMode, active.length],
            getColor: [theme],
            getBackgroundColor: [theme],
            getBorderColor: [theme],
            getPosition: [active.length],
          },
        }),
      );
    }
  }

  return layers;
}
