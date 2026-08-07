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
 * All ramps below are drawn from colour-blind-safe families (viridis, plasma,
 * YlGnBu, Okabe-Ito). None of them rely on a red/green contrast to carry
 * meaning, so the map stays readable for deuteranopes on a projector.
 */

/** Asking rent, $/SF/yr. Viridis — perceptually uniform, legible on dark. */
export const RENT_STOPS: ColorStop[] = [
  { value: 0, color: [59, 82, 139], label: '< $50' },
  { value: 50, color: [44, 114, 142], label: '$50' },
  { value: 70, color: [33, 145, 140], label: '$70' },
  { value: 90, color: [94, 201, 98], label: '$90' },
  { value: 120, color: [181, 222, 43], label: '$120' },
  { value: 150, color: [253, 231, 37], label: '$150+' },
];

/** Total available SF. Plasma, so it never reads as the rent ramp. */
export const SF_STOPS: ColorStop[] = [
  { value: 0, color: [106, 0, 168], label: '< 5k' },
  { value: 5_000, color: [177, 42, 144], label: '5k' },
  { value: 20_000, color: [225, 100, 98], label: '20k' },
  { value: 50_000, color: [252, 166, 54], label: '50k' },
  { value: 100_000, color: [240, 249, 33], label: '100k+' },
];

/** Months until the earliest space is available. YlGnBu, reversed. */
export const AVAILABILITY_STOPS: ColorStop[] = [
  { value: 0, color: [237, 248, 177], label: 'Now' },
  { value: 3, color: [127, 205, 187], label: '3 mo' },
  { value: 6, color: [65, 182, 196], label: '6 mo' },
  { value: 12, color: [44, 127, 184], label: '12 mo' },
  { value: 24, color: [37, 52, 148], label: '24 mo+' },
];

/** Okabe-Ito categorical — distinguishable under every common CVD type. */
export const CLASS_STOPS: ColorStop[] = [
  { value: 0, color: [86, 180, 233], label: 'Class A' },
  { value: 1, color: [230, 159, 0], label: 'Class B' },
  { value: 2, color: [204, 121, 167], label: 'Class C' },
  { value: 3, color: [122, 132, 145], label: 'Unrated' },
];

export const FLOOR_BAND_COLOR: RGBA = [255, 255, 255, 205];
export const FLOOR_BAND_PARTIAL_COLOR: RGBA = [148, 205, 255, 150];
export const SELECTED_COLOR: RGBA = [255, 214, 92, 255];
export const DIMMED_COLOR: RGBA = [78, 88, 102, 90];
export const HOVER_COLOR: RGBA = [255, 255, 255, 255];
export const RADIUS_FILL: RGBA = [76, 154, 255, 26];
export const RADIUS_LINE: RGBA = [76, 154, 255, 190];

const BUILDING_ALPHA = 210;

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

/** Used when a building has no value for the active mode. */
const UNKNOWN: RGBA = [110, 120, 133, 170];

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
