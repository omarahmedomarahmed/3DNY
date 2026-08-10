import { BRAND, RENT_RAMP, SURFACE, mix, rgba } from '@/lib/brand';
import type { BuildingWithSpaces, ColorMode } from '@/types';

export type RGBA = [number, number, number, number];
export type RGB = [number, number, number];

export interface ColorStop {
  /** Lower bound of the bucket, in the mode's own units. */
  value: number;
  color: RGB;
  label: string;
}

/**
 * Every ramp below is built from the Cresa palette in @/lib/brand — no hexes
 * are invented here. The map runs on a LIGHT basemap, so the rule that governs
 * all of these is: matching buildings are saturated and dark, everything else
 * is a pale gray that recedes. None of the ramps carry meaning through a
 * red/green contrast, so they stay readable for deuteranopes on a projector.
 */

/** Hex → RGB triple, for stop tables. */
function rgb(hex: string): RGB {
  const [r, g, b] = rgba(hex);
  return [r, g, b];
}

/** Midnight lightened toward white — the neutral tint used by several ramps. */
function tint(t: number): string {
  return mix(BRAND.midnight, '#FFFFFF', t);
}

/**
 * Asking rent, $/SF/yr. RENT_RAMP runs Midnight → Stadium Blue → Bright Blue →
 * Goldenrod → Warm Orange: cool is cheap, hot is expensive.
 */
export const RENT_STOPS: ColorStop[] = [
  { value: 0, color: rgb(RENT_RAMP[0]), label: '< $50' },
  { value: 50, color: rgb(RENT_RAMP[1]), label: '$50' },
  { value: 80, color: rgb(RENT_RAMP[2]), label: '$80' },
  { value: 110, color: rgb(RENT_RAMP[3]), label: '$110' },
  { value: 150, color: rgb(RENT_RAMP[4]), label: '$150+' },
];

/** Total available SF. A single-hue Midnight ramp: pale = small, deep = large. */
export const SF_STOPS: ColorStop[] = [
  { value: 0, color: rgb(tint(0.78)), label: '< 5k' },
  { value: 5_000, color: rgb(tint(0.58)), label: '5k' },
  { value: 20_000, color: rgb(tint(0.38)), label: '20k' },
  { value: 50_000, color: rgb(tint(0.18)), label: '50k' },
  { value: 100_000, color: rgb(BRAND.midnight), label: '100k+' },
];

/**
 * Months until the earliest space is available. Goldenrod means "you can have
 * it now" — the one thing on the map that should pull the eye — and the ramp
 * cools into Midnight as the date slips away.
 */
export const AVAILABILITY_STOPS: ColorStop[] = [
  { value: 0, color: rgb(BRAND.goldenrod), label: 'Now' },
  { value: 3, color: rgb(mix(BRAND.goldenrod, '#FFFFFF', 0.45)), label: '3 mo' },
  { value: 6, color: rgb(mix(BRAND.brightBlue, '#FFFFFF', 0.45)), label: '6 mo' },
  { value: 12, color: rgb(BRAND.brightBlue), label: '12 mo' },
  { value: 24, color: rgb(BRAND.midnight), label: '24 mo+' },
];

/** Categorical. Midnight / Stadium Blue / a lighter Midnight tint / neutral. */
export const CLASS_STOPS: ColorStop[] = [
  { value: 0, color: rgb(BRAND.midnight), label: 'Class A' },
  { value: 1, color: rgb(BRAND.stadiumBlue), label: 'Class B' },
  { value: 2, color: rgb(tint(0.5)), label: 'Class C' },
  { value: 3, color: rgb('#8A9099'), label: 'Unrated' },
];

/** Available floors, in Goldenrod, against Midnight-toned building massing. */
export const FLOOR_BAND_COLOR: RGBA = rgba(BRAND.goldenrod, 240);
export const FLOOR_BAND_PARTIAL_COLOR: RGBA = rgba(BRAND.goldenrod, 155);

/** Warm Orange, so a selected floor separates from its Goldenrod neighbours. */
export const SELECTED_COLOR: RGBA = rgba(BRAND.warmOrange, 255);

/**
 * The three things that can be true of a floor, and how loudly each says so.
 *
 * The whole map is built around one rule: a Goldenrod band on the 14th floor
 * is the loudest thing on screen. Adding two more kinds of band to the same
 * facade is the most direct threat that rule has faced, because the new ones
 * are more numerous — a tower has one availability and forty tenants.
 *
 * So the hierarchy is enforced three ways at once, not just by hue:
 *
 *   available  Goldenrod, full opacity, thickest stripe, furthest out.
 *   client     Teal. Ours to point at, so it has to be findable — but a
 *              thinner stripe than availability and a colour that does not
 *              sit next to gold on the wheel.
 *   occupied   Deliberately recessive. It is context: the answer to "what
 *              about the rest of the building", not something to look at. On
 *              a busy frame these should read as tone on the facade rather
 *              than as marks competing for a glance.
 *
 * Teal is chosen against the rest of the map rather than in isolation: the
 * massing runs Midnight through blue to gold with the rent ramp, the parks are
 * a desaturated sage, and none of those is a saturated blue-green.
 */
export const OCCUPANCY_COLORS: Record<
  string,
  { entire: RGBA; partial: RGBA; legend: string }
> = {
  available: {
    entire: rgba(BRAND.goldenrod, 240),
    partial: rgba(BRAND.goldenrod, 155),
    legend: BRAND.goldenrod,
  },
  client: {
    entire: rgba('#00A38C', 235),
    partial: rgba('#00A38C', 160),
    legend: '#00A38C',
  },
  occupied: {
    // Translucent on purpose. A block tenancy can cover twelve floors, and at
    // full opacity twelve floors of grey is a slab that replaces the tower
    // rather than annotating it. Letting the facade through keeps it reading
    // as a tint on the building — context, which is what it is.
    entire: rgba('#94A2BC', 112),
    partial: rgba('#94A2BC', 88),
    legend: '#94A2BC',
  },
};

/** On the dark map the occupied tone has to lift, not darken, to read at all. */
export const OCCUPIED_DARK: { entire: RGBA; partial: RGBA; legend: string } = {
  entire: rgba('#8494B5', 122),
  partial: rgba('#8494B5', 96),
  legend: '#8494B5',
};

// ---------------------------------------------------------------------------
// Colours the user has changed
// ---------------------------------------------------------------------------

/**
 * Overrides, as hex. Anything unset falls through to the defaults above.
 *
 * Every default here was chosen against the whole frame — Goldenrod is loud
 * because availability is the subject, teal is teal because nothing else on
 * the map is blue-green, occupied is translucent because twelve floors of it
 * would otherwise replace the tower. Handing those over is a real risk, and it
 * is still right: a broker on somebody else's projector, or in front of a
 * colour-blind client, can see something we cannot, and telling them the
 * default is fine does not make it legible in the room they are standing in.
 *
 * The one thing not offered is the ability to turn availability down. Opacity,
 * stripe thickness and draw order are what actually enforce "availability is
 * the loudest thing on screen"; only the hue is exposed, so a different colour
 * still arrives at full strength, still thickest, still drawn last.
 */
export interface ColorOverrides {
  available?: string;
  client?: string;
  occupied?: string;
  selectedBuilding?: string;
  selectedSpace?: string;
  scaleLow?: string;
  scaleHigh?: string;
}

/** The alpha pair a band kind is drawn at, kept whatever the hue becomes. */
const BAND_ALPHA: Record<string, { entire: number; partial: number }> = {
  available: { entire: 240, partial: 155 },
  client: { entire: 235, partial: 160 },
  occupied: { entire: 112, partial: 88 },
};

export function occupancyColors(
  kind: string,
  theme: MapTheme,
  overrides?: ColorOverrides,
) {
  const custom = overrides?.[kind as 'available' | 'client' | 'occupied'];
  if (custom) {
    const alpha = BAND_ALPHA[kind] ?? BAND_ALPHA.available;
    return {
      entire: rgba(custom, alpha.entire),
      partial: rgba(custom, alpha.partial),
      legend: custom,
    };
  }
  if (kind === 'occupied' && theme === 'dark') return OCCUPIED_DARK;
  return OCCUPANCY_COLORS[kind] ?? OCCUPANCY_COLORS.available;
}

/** The building currently clicked. */
export function selectedBuildingColor(overrides?: ColorOverrides): RGBA {
  return overrides?.selectedBuilding ? rgba(overrides.selectedBuilding, 255) : SELECTED_COLOR;
}

/** The band for the space currently clicked, within its building. */
export function selectedSpaceColor(overrides?: ColorOverrides): RGBA {
  return overrides?.selectedSpace ? rgba(overrides.selectedSpace, 255) : SELECTED_COLOR;
}

/**
 * Filtered-out massing. On a LIGHT basemap the dimmed state must be LIGHTER
 * than the highlighted state — a warm gray that sits behind everything.
 */
export const DIMMED_COLOR: RGBA = rgba('#D8DCE4', 130);

/**
 * The surrounding city — every building the sheet says nothing about. Paler
 * and slightly cooler than the dimmed state, and partly transparent, so the
 * hierarchy is unambiguous at a glance: coloured is the answer, gray is a
 * building you filtered out, and this is Manhattan.
 */
export const CITY_CONTEXT_COLOR: RGBA = rgba('#C6CFDE', 255);

/** Hover lifts a building toward Goldenrod; on white, lifting to white hides it. */
export const HOVER_COLOR: RGBA = rgba(BRAND.goldenrod, 255);

export const RADIUS_FILL: RGBA = rgba(BRAND.goldenrod, 28);
export const RADIUS_LINE: RGBA = rgba(BRAND.midnight, 215);

/**
 * Building labels. A white pill with a hairline outline and Midnight type is
 * the only combination that stays legible over both the pale basemap and a
 * dark tower face — the pill is what makes the map readable in a meeting
 * without anyone having to hover.
 */
export const LABEL_TEXT_COLOR: RGBA = rgba(BRAND.midnight, 255);
export const LABEL_BG_COLOR: RGBA = rgba(SURFACE.white, 242);
export const LABEL_BORDER_COLOR: RGBA = rgba(SURFACE.hairlineStrong, 255);

/** Solid enough to read as a real building against near-white ground. */
const BUILDING_ALPHA = 235;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Piecewise-linear lookup across a stop list, clamped at both ends. */
export function sampleStops(stops: ColorStop[], value: number): RGB {
  if (value <= stops[0].value) return stops[0].color;
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const next = stops[i];
    if (value <= next.value) {
      const span = next.value - prev.value;
      const t = span === 0 ? 0 : (value - prev.value) / span;
      return [
        Math.round(lerp(prev.color[0], next.color[0], t)),
        Math.round(lerp(prev.color[1], next.color[1], t)),
        Math.round(lerp(prev.color[2], next.color[2], t)),
      ];
    }
  }
  return stops[stops.length - 1].color;
}

function baseStops(mode: ColorMode): ColorStop[] {
  switch (mode) {
    case 'rent':
      return RENT_STOPS;
    case 'sf':
      return SF_STOPS;
    case 'availability':
      return AVAILABILITY_STOPS;
    case 'class':
      return CLASS_STOPS;
  }
}

export function stopsForMode(mode: ColorMode, overrides?: ColorOverrides): ColorStop[] {
  const stops = baseStops(mode);

  // The user picks the two ends and the middle is interpolated, rather than
  // asking for five colours. Every ramp here is already a two-end idea — cool
  // to hot, pale to deep, now to never — and the buckets in between only have
  // to be ordered, which an interpolation guarantees and five hand-picked
  // colours do not.
  //
  // Class is categorical: A, B, C and unknown are not a scale, so a gradient
  // across them would invent an ordering the data does not carry.
  const { scaleLow, scaleHigh } = overrides ?? {};
  if (mode === 'class' || (!scaleLow && !scaleHigh)) return stops;

  const low = scaleLow ?? cssHex(stops[0].color);
  const high = scaleHigh ?? cssHex(stops[stops.length - 1].color);
  const last = Math.max(1, stops.length - 1);

  return stops.map((stop, i) => ({
    ...stop,
    color: rgb(mix(low, high, i / last)),
  }));
}

/** RGB triple back to hex, so a default end can be fed to `mix`. */
function cssHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/** Months from today until the soonest available space, null if unknown. */
export function monthsUntilAvailable(building: BuildingWithSpaces): number | null {
  let soonest: number | null = null;
  for (const s of building.spaces) {
    if (!s.available_from) continue;
    const t = Date.parse(s.available_from);
    if (Number.isNaN(t)) continue;
    if (soonest === null || t < soonest) soonest = t;
  }
  if (soonest === null) return null;
  const months = (soonest - Date.now()) / (1000 * 60 * 60 * 24 * 30.44);
  return Math.max(0, months);
}

function classIndex(building: BuildingWithSpaces): number {
  switch (building.class) {
    case 'A':
      return 0;
    case 'B':
      return 1;
    case 'C':
      return 2;
    default:
      return 3;
  }
}

/**
 * Used when a building matches the filters but has no value for the active
 * mode. Mid-gray: clearly still in play, clearly not carrying a reading.
 */
const UNKNOWN: RGBA = rgba('#8D98AE', 205);

export function colorForBuilding(
  building: BuildingWithSpaces,
  mode: ColorMode,
  overrides?: ColorOverrides,
): RGBA {
  // Sampled from the same stops the legend draws, so a recoloured ramp moves
  // the towers and the swatch bar together. They are the same statement.
  const stops = stopsForMode(mode, overrides);
  switch (mode) {
    case 'rent': {
      const rent = building.minRent ?? building.maxRent;
      if (rent === null || rent === undefined) return UNKNOWN;
      const [r, g, b] = sampleStops(stops, rent);
      return [r, g, b, BUILDING_ALPHA];
    }
    case 'sf': {
      if (!building.totalAvailableSf) return UNKNOWN;
      const [r, g, b] = sampleStops(stops, building.totalAvailableSf);
      return [r, g, b, BUILDING_ALPHA];
    }
    case 'availability': {
      const months = monthsUntilAvailable(building);
      if (months === null) return UNKNOWN;
      const [r, g, b] = sampleStops(stops, months);
      return [r, g, b, BUILDING_ALPHA];
    }
    case 'class': {
      const [r, g, b] = stops[classIndex(building)].color;
      return [r, g, b, BUILDING_ALPHA];
    }
  }
}

export function cssRgb(color: RGB | RGBA): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

/** CSS gradient for a legend swatch bar; categorical modes get hard edges. */
export function gradientForMode(mode: ColorMode, overrides?: ColorOverrides): string {
  const stops = stopsForMode(mode, overrides);
  if (mode === 'class') {
    const n = stops.length;
    const segments = stops.map((s, i) => {
      const from = (i / n) * 100;
      const to = ((i + 1) / n) * 100;
      return `${cssRgb(s.color)} ${from}% ${to}%`;
    });
    return `linear-gradient(to right, ${segments.join(', ')})`;
  }
  const span = stops[stops.length - 1].value - stops[0].value || 1;
  const segments = stops.map((s) => {
    const pct = ((s.value - stops[0].value) / span) * 100;
    return `${cssRgb(s.color)} ${pct}%`;
  });
  return `linear-gradient(to right, ${segments.join(', ')})`;
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export type MapTheme = 'dark' | 'light';

/**
 * The colours that have to change with the basemap.
 *
 * The rent, size and class ramps are deliberately NOT in here: they are the
 * legend, and a swatch that means "$110/SF" has to mean the same thing on both
 * themes. Only the recessive parts — the city that is not the answer, and the
 * name-plates that sit over it — get a per-theme value.
 */
export interface ThemeColors {
  /** Buildings the filters excluded. */
  dimmed: RGBA;
  /** The surrounding city from NYC footprints. */
  cityContext: RGBA;
  /** The ground plane itself — the block interiors between streets. */
  ground: RGBA;
  /** Rivers and ponds — the deep centre of the channel. */
  water: RGBA;
  /** The shallow band along the shore, which is what gives water its depth. */
  waterShallow: RGBA;
  /** The bright line where water meets land. */
  waterEdge: RGBA;
  /** Lawn and greensward. */
  park: RGBA;
  /** Paved plazas and triangles — Herald Square, not Central Park. */
  parkPlaza: RGBA;
  /** Playgrounds and ball courts. */
  parkCourt: RGBA;
  /** Tree canopy. */
  canopy: RGBA;
  /** Tree trunk. */
  trunk: RGBA;
  /**
   * Timber, which roof water tanks are blended toward. Parapets, bulkheads
   * and setbacks have no colour of their own: they take the fill of the
   * building they stand on, so roof furniture reads as the same building
   * rather than as grey objects placed on top of it.
   */
  waterTank: RGBA;
  /** The railing enclosure around a subway stair. */
  entranceStair: RGBA;
  /** An elevator headhouse, which is a small building rather than a railing. */
  entranceElevator: RGBA;
  /** The globe lamp that has meant "this entrance is open" since the eighties. */
  entranceGlobe: RGBA;
  /** The walls of a modelled station headhouse. */
  stationWall: RGBA;
  /** Its canopy slab, a shade lighter so the shelter reads as separate. */
  stationRoof: RGBA;
  /** The pavement band flanking every roadbed. */
  sidewalk: RGBA;
  /** The kerb line between sidewalk and asphalt. */
  roadCasing: RGBA;
  /** The roadbed. */
  roadFill: RGBA;
  /** Street names painted onto the asphalt at close zoom. */
  streetName: RGBA;
  /** The halo behind painted names, keeping them legible over the kerb. */
  streetNameHalo: RGBA;
  /** Floor plate lines drawn up every facade. */
  floorLine: RGBA;
  /** The post a transit marker stands on. */
  transitMast: RGBA;
  /** Soft darkening where a building meets the street. */
  contactShadow: RGBA;
  labelText: RGBA;
  labelBg: RGBA;
  labelBorder: RGBA;
  radiusFill: RGBA;
  radiusLine: RGBA;
  /** Tint that cast shadows are drawn in, as RGBA 0-1 alpha. */
  shadow: [number, number, number, number];
}

const LIGHT_THEME: ThemeColors = {
  dimmed: rgba('#D8DCE4', 130),
  cityContext: rgba('#C6CFDE', 255),
  // Daylight ground: block interiors a quiet blue-gray, pavements a step
  // lighter, roadbeds white — the Positron reading, but drawn by us.
  // The blocks have to be a clear step darker than the pavement, or a white
  // roadbed on a near-white block field leaves no street grid at all.
  ground: rgba('#D9E0EB', 255),
  water: rgba('#A9C2DF', 255),
  waterShallow: rgba('#C6D9EC', 255),
  waterEdge: rgba('#DCE9F5', 255),
  // Greens are desaturated toward the map's blue cast on purpose. A saturated
  // park green would be the second-loudest thing on screen after Goldenrod,
  // and parks are orientation, not data.
  park: rgba('#C8DBC2', 255),
  parkPlaza: rgba('#DFE2DC', 255),
  parkCourt: rgba('#CFDCCB', 255),
  canopy: rgba('#A6C39C', 255),
  trunk: rgba('#9AA0A2', 255),
  waterTank: rgba('#8C7B6B', 255),
  entranceStair: rgba('#5A6473', 255),
  entranceElevator: rgba('#7C8797', 255),
  // The real globes are a green so desaturated it reads almost grey by day.
  // Kept that way on purpose: a saturated green dot at every corner would be
  // a second thing competing for the eye with the availability bands.
  entranceGlobe: rgba('#4E7A55', 255),
  stationWall: rgba('#7C879B', 255),
  stationRoof: rgba('#9CA7BA', 255),
  sidewalk: rgba('#EDF1F7', 255),
  roadCasing: rgba('#BFC7D6', 255),
  roadFill: rgba('#FFFFFF', 255),
  streetName: rgba('#5E6A85', 235),
  streetNameHalo: rgba('#FDFDFE', 200),
  // Darker than the facade on a light map: a floor line is a shadow gap
  // between plates, not a highlight.
  floorLine: rgba('#0A1428', 42),
  transitMast: rgba('#48546C', 255),
  contactShadow: rgba('#0A1A3A', 30),
  labelText: rgba(BRAND.midnight, 255),
  labelBg: rgba(SURFACE.white, 242),
  labelBorder: rgba(SURFACE.hairlineStrong, 255),
  radiusFill: rgba(BRAND.goldenrod, 28),
  radiusLine: rgba(BRAND.midnight, 215),
  shadow: [0, 30, 90, 0.16],
};

/**
 * On a dark basemap the whole hierarchy inverts: the recessive city has to be
 * a shade ABOVE the ground rather than below it, or the buildings read as holes
 * punched in the map. Name-plates become dark pills with near-white type, which
 * is the only combination that survives both a black street and a lit facade.
 */
const DARK_THEME: ThemeColors = {
  dimmed: rgba('#2A3345', 170),
  // Lifted enough that the surrounding city still reads as buildings once the
  // facade's vertical shading darkens their bases.
  cityContext: rgba('#47526C', 255),
  // Night ground: near-black blocks, streets a shade lighter — the street
  // grid reads as the lit network it is at night, kerbs as lit stone edges.
  ground: rgba('#0A0E17', 255),
  water: rgba('#070C16', 255),
  waterShallow: rgba('#101B2E', 255),
  waterEdge: rgba('#1B2B45', 255),
  // At night a park is a hole in the lit grid, not a green field — dark, but
  // warm enough against the blue-black blocks to read as planting.
  park: rgba('#101A15', 255),
  parkPlaza: rgba('#161B22', 255),
  parkCourt: rgba('#131D18', 255),
  canopy: rgba('#1E3325', 255),
  trunk: rgba('#20262E', 255),
  waterTank: rgba('#4C4238', 255),
  entranceStair: rgba('#3B4557', 255),
  entranceElevator: rgba('#46516A', 255),
  // At night the globe is genuinely lit, so it is the one thing down here
  // allowed to glow — but green, and small, so it never reads as Goldenrod.
  entranceGlobe: rgba('#57A268', 255),
  stationWall: rgba('#3E495F', 255),
  stationRoof: rgba('#4C5972', 255),
  sidewalk: rgba('#151C2B', 255),
  roadCasing: rgba('#2C3750', 255),
  roadFill: rgba('#1D2637', 255),
  streetName: rgba('#A7B8DC', 215),
  streetNameHalo: rgba('#0F1522', 190),
  // Lighter than the facade on a dark map — the same reading inverted, as a
  // lit slot between floor plates.
  floorLine: rgba('#9FB4D8', 46),
  transitMast: rgba('#8698BA', 255),
  contactShadow: rgba('#000308', 74),
  labelText: rgba('#F4F7FC', 255),
  labelBg: rgba('#0B1220', 232),
  labelBorder: rgba('#46536E', 255),
  radiusFill: rgba(BRAND.goldenrod, 34),
  radiusLine: rgba(BRAND.goldenrod, 225),
  shadow: [0, 0, 0, 0.34],
};

export function themeColors(theme: MapTheme): ThemeColors {
  return theme === 'dark' ? DARK_THEME : LIGHT_THEME;
}

// ---------------------------------------------------------------------------
// Transit
// ---------------------------------------------------------------------------

/**
 * One colour per mode, all drawn from the Cresa palette so transit reads as
 * part of the same product rather than as a borrowed transit map. Subway leads
 * because it is the mode that decides a lease; bus is deliberately the quietest
 * because there are twenty times as many of them.
 */
export const TRANSIT_COLORS: Record<string, RGBA> = {
  subway: rgba(BRAND.brightBlue, 255),
  rail: rgba(BRAND.midnight, 255),
  path: rgba(BRAND.stadiumBlue, 255),
  ferry: rgba('#0E7C86', 255),
  tram: rgba(BRAND.warmOrange, 255),
  bus: rgba('#7A879E', 235),
};

/**
 * The dashed walk line, and the pill carrying its minutes.
 *
 * These used to be Goldenrod, which was a straight breach of the one rule this
 * map is built around. Goldenrod means available space and nothing else — and
 * a gold dash lying on the pavement beside a tower with gold bands on it reads
 * as a floor plate that fell off. Worse, there are five walk lines and one
 * building, so the routes were quietly out-shouting the thing they exist to
 * give context to.
 *
 * What replaces it is how a route is drawn on paper: a pale casing under a
 * dark dashed line, so the path reads as continuous even where an individual
 * dash is only a few pixels, and stays legible whether it crosses roadway,
 * pavement or a park. The dash takes the same ink as the minutes pill at the
 * end of it, because the route and its time are one object.
 */
export interface WalkColors {
  /** The dash itself. */
  line: RGBA;
  /** The wider, softer line under it that keeps the route continuous. */
  casing: RGBA;
  labelBg: RGBA;
  labelText: RGBA;
}

export const WALK_LIGHT: WalkColors = {
  line: rgba(BRAND.midnight, 250),
  casing: rgba('#FFFFFF', 215),
  labelBg: rgba(BRAND.midnight, 240),
  labelText: rgba('#FFFFFF', 255),
};

export const WALK_DARK: WalkColors = {
  // Pale ink on the dark map, for the same reason the light map uses dark ink:
  // the line has to beat the surface it crosses, not match it.
  line: rgba('#E8EDF7', 245),
  casing: rgba('#0A1330', 210),
  labelBg: rgba('#E8EDF7', 240),
  labelText: rgba(BRAND.midnight, 255),
};

export function walkColors(theme: MapTheme): WalkColors {
  return theme === 'dark' ? WALK_DARK : WALK_LIGHT;
}
