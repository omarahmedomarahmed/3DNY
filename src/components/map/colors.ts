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

export function stopsForMode(mode: ColorMode): ColorStop[] {
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
): RGBA {
  switch (mode) {
    case 'rent': {
      const rent = building.minRent ?? building.maxRent;
      if (rent === null || rent === undefined) return UNKNOWN;
      const [r, g, b] = sampleStops(RENT_STOPS, rent);
      return [r, g, b, BUILDING_ALPHA];
    }
    case 'sf': {
      if (!building.totalAvailableSf) return UNKNOWN;
      const [r, g, b] = sampleStops(SF_STOPS, building.totalAvailableSf);
      return [r, g, b, BUILDING_ALPHA];
    }
    case 'availability': {
      const months = monthsUntilAvailable(building);
      if (months === null) return UNKNOWN;
      const [r, g, b] = sampleStops(AVAILABILITY_STOPS, months);
      return [r, g, b, BUILDING_ALPHA];
    }
    case 'class': {
      const [r, g, b] = CLASS_STOPS[classIndex(building)].color;
      return [r, g, b, BUILDING_ALPHA];
    }
  }
}

export function cssRgb(color: RGB | RGBA): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

/** CSS gradient for a legend swatch bar; categorical modes get hard edges. */
export function gradientForMode(mode: ColorMode): string {
  const stops = stopsForMode(mode);
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
  /** Floor plate lines drawn up every facade. */
  floorLine: RGBA;
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
  // Darker than the facade on a light map: a floor line is a shadow gap
  // between plates, not a highlight.
  floorLine: rgba('#0A1428', 42),
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
  cityContext: rgba('#39435A', 255),
  // Lighter than the facade on a dark map — the same reading inverted, as a
  // lit slot between floor plates.
  floorLine: rgba('#9FB4D8', 46),
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
