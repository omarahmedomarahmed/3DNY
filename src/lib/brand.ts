/**
 * Cresa brand palette, taken from the Primary Colors Guide.
 * Midnight and Goldenrod lead; grays carry contrast; the secondary palette
 * adds range without competing with the hero colours.
 *
 * Keep this file as the single source of truth — Tailwind reads the same
 * values from tailwind.config.ts, and the map layers read them from here.
 */

export const BRAND = {
  // Primary
  midnight: '#001E5A',
  goldenrod: '#FFB600',
  lightGray: '#E6E6E6',
  darkGray: '#595959',

  // Secondary
  brightBlue: '#0056DA',
  warmOrange: '#FF8200',
  stadiumBlue: '#243E8C',
} as const;

/** Tints and shades derived from the hero colours, for surfaces and states. */
export const SURFACE = {
  white: '#FFFFFF',
  offWhite: '#F7F8FA',
  hairline: '#E6E6E6',
  hairlineStrong: '#D2D6DD',
  ink: BRAND.midnight,
  inkSoft: '#3A4A6B',
  muted: BRAND.darkGray,
  mutedSoft: '#8A9099',
} as const;

/** Semantic colours. Amber is the brand's, not a generic warning yellow. */
export const STATUS = {
  ok: '#1E7F4C',
  okSurface: '#E8F5EE',
  warn: BRAND.warmOrange,
  warnSurface: '#FFF3E5',
  danger: '#C0392B',
  dangerSurface: '#FBEBE9',
  info: BRAND.brightBlue,
  infoSurface: '#E8F0FE',
} as const;

/** Hex → [r,g,b,a] for deck.gl, which wants byte arrays. */
export function rgba(hex: string, alpha = 255): [number, number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    alpha,
  ];
}

/** Linear blend between two hex colours, t in [0,1]. */
export function mix(from: string, to: string, t: number): string {
  const a = rgba(from);
  const b = rgba(to);
  const c = a.slice(0, 3).map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The rent scale runs Midnight → Stadium Blue → Bright Blue → Goldenrod →
 * Warm Orange. It reads as "cool is cheap, hot is expensive", stays inside the
 * brand, and is distinguishable without relying on a red/green split.
 */
export const RENT_RAMP = [
  BRAND.midnight,
  BRAND.stadiumBlue,
  BRAND.brightBlue,
  BRAND.goldenrod,
  BRAND.warmOrange,
] as const;
