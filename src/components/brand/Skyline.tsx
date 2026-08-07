/**
 * Manhattan skyline artwork — hand-drawn inline SVG.
 *
 * No external images, no stock licensing, nothing to load: the profiles are
 * path data, so they paint with the first frame and stay crisp at any size.
 * Every silhouette is a real Midtown shape — setbacks, stepped crowns, masts
 * and slabs — rather than a row of rectangles, because the whole point is that
 * a broker recognises the skyline.
 *
 * All four exports are decorative (aria-hidden) and colour themselves from
 * explicit Cresa hex values, with `currentColor` available where a caller
 * wants the artwork to inherit type colour instead.
 */

import type { CSSProperties } from 'react';

const MIDNIGHT = '#001E5A';
const STADIUM = '#243E8C';
const MIDNIGHT_400 = '#5C6B8A';
const GOLDENROD = '#FFB600';

// ---------------------------------------------------------------------------
// Path data. Authored on a 1200 × 200 grid with the street at y = 190.
// ---------------------------------------------------------------------------

/** The detailed row: low blocks between recognisable towers. */
const SKYLINE: string[] = [
  // Low corner block with a parapet setback.
  'M0 190 V152 H14 V144 H46 V190 Z',
  // Pre-war loft building with a rooftop water tank.
  'M42 190 V134 H88 V190 Z M58 134 H70 V124 H68 V118 H60 V124 H58 Z',
  'M84 190 V150 H128 V190 Z',
  // 1916-zoning ziggurat with a rooftop mast.
  'M122 190 V128 H134 V112 H144 V96 H160 V112 H168 V128 H176 V190 Z ' +
    'M150 96 H154 V70 H153 V56 H151 V70 H150 Z',
  'M170 190 V138 H212 V190 Z',
  // Rockefeller-style slab with a mechanical penthouse.
  'M206 190 V112 H262 V190 Z M222 112 H246 V100 H222 Z',
  'M256 190 V146 H300 V190 Z',
  // Stepped-back tower.
  'M294 190 V126 H306 V106 H318 V86 H340 V106 H348 V126 H352 V190 Z',
  'M346 190 V132 H392 V190 Z',
  // Tapered crown with a spire — One Vanderbilt in profile.
  'M386 190 V104 H446 V190 Z M392 104 L400 64 H432 L440 104 Z ' +
    'M414 64 H418 V40 H417 V30 H415 V40 H414 Z',
  'M440 190 V140 H486 V190 Z',
  // The Empire State Building: four setbacks and the mooring mast.
  'M480 190 V118 H492 V102 H502 V78 H512 V54 H524 V78 H534 V102 H544 V118 H556 V190 Z ' +
    'M514 54 H522 V44 H520 V30 H519 V14 H517 V30 H516 V44 H514 Z',
  'M550 190 V136 H596 V190 Z',
  // The Chrysler Building: tiered crown tapering to the needle.
  'M590 190 V100 H650 V190 Z ' +
    'M608 100 H644 V86 H639 V76 H634 V66 H630 V54 H627 V26 H625 V54 H622 V66 H618 V76 ' +
    'H613 V86 H608 Z',
  'M644 190 V142 H690 V190 Z',
  // A pencil tower — 432 Park's plain square shaft.
  'M684 190 V44 H718 V190 Z',
  // Wide slab with a single setback.
  'M722 190 V124 H790 V190 Z M736 124 H774 V110 H736 Z',
  // Angled crystalline crown with a spire — Bank of America Tower.
  'M784 190 V96 H840 V190 Z M790 96 L806 46 H818 L834 96 Z ' +
    'M810 46 H814 V16 H813 V6 H811 V16 H810 Z',
  'M834 190 V146 H884 V190 Z',
  'M878 190 V132 H890 V112 H900 V92 H922 V112 H932 V132 H940 V190 Z',
  'M934 190 V130 H986 V190 Z',
  // Twin-shaft tower with a notched roofline.
  'M980 190 V100 H1010 V112 H1016 V100 H1046 V190 Z',
  'M1040 190 V150 H1090 V190 Z',
  'M1084 190 V138 H1096 V120 H1106 V104 H1124 V120 H1134 V138 H1146 V190 Z',
  'M1140 190 V158 H1200 V190 Z',
];

/** Lit windows, in [x, y] pairs. Sparse on purpose — an accent, not a texture. */
const LIT_WINDOWS: [number, number][] = [
  [136, 120], [146, 120],
  [216, 130], [228, 130], [240, 130], [252, 130],
  [400, 120], [410, 120], [420, 120], [430, 120],
  [506, 120], [516, 120], [526, 120],
  [512, 88], [520, 88],
  [606, 120], [614, 120], [622, 120], [630, 120], [638, 120],
  [692, 70], [700, 70], [708, 70],
  [692, 88], [700, 88], [708, 88],
  [796, 120], [806, 120], [816, 120], [826, 120],
];

/** Distant towers for the hero's back plane. Baseline y = 250. */
const FAR_SKYLINE: string[] = [
  'M20 250 V132 H56 V250 Z',
  'M74 250 V104 H84 V92 H104 V104 H112 V250 Z',
  'M130 250 V146 H168 V250 Z',
  'M186 250 V88 H208 V250 Z M195 88 H199 V56 H198 V44 H196 V56 H195 Z',
  'M226 250 V126 H272 V250 Z',
  'M290 250 V100 H302 V84 H322 V100 H332 V250 Z',
  'M350 250 V140 H392 V250 Z',
  'M410 250 V72 H436 V250 Z M420 72 H426 V40 H424 V22 H422 V40 H420 Z',
  'M456 250 V134 H496 V250 Z',
  'M516 250 V96 H528 V80 H552 V96 H562 V250 Z',
  'M582 250 V120 H620 V250 Z',
  'M640 250 V64 H668 V250 Z M650 64 H656 V34 H655 V18 H653 V34 H650 Z',
  'M686 250 V138 H726 V250 Z',
  'M744 250 V102 H756 V86 H778 V102 H788 V250 Z',
  'M806 250 V128 H850 V250 Z',
  'M868 250 V78 H892 V250 Z M876 78 H882 V48 H880 V32 H878 V48 H876 Z',
  'M910 250 V136 H952 V250 Z',
  'M970 250 V98 H982 V84 H1004 V98 H1014 V250 Z',
  'M1032 250 V142 H1074 V250 Z',
  'M1092 250 V90 H1116 V250 Z M1100 90 H1106 V58 H1104 V44 H1102 V58 H1100 Z',
  'M1134 250 V130 H1180 V250 Z',
];

/** Chunky near blocks for the hero's front plane. Runs past both edges. */
const NEAR_BLOCKS: string[] = [
  'M-10 262 V196 H60 V186 H120 V262 Z',
  'M112 262 V178 H180 V190 H214 V262 Z',
  'M206 262 V206 H268 V262 Z',
  'M260 262 V172 H274 V162 H320 V172 H334 V262 Z',
  'M328 262 V198 H408 V262 Z',
  'M400 262 V182 H452 V194 H496 V262 Z',
  'M490 262 V204 H560 V262 Z',
  'M552 262 V176 H566 V166 H612 V176 H626 V262 Z',
  'M620 262 V200 H700 V262 Z',
  'M692 262 V184 H758 V196 H796 V262 Z',
  'M790 262 V206 H852 V262 Z',
  'M846 262 V174 H860 V164 H906 V174 H920 V262 Z',
  'M914 262 V198 H994 V262 Z',
  'M986 262 V186 H1042 V196 H1084 V262 Z',
  'M1078 262 V202 H1150 V262 Z',
  'M1144 262 V180 H1210 V262 Z',
];

// ---------------------------------------------------------------------------
// SkylineBand
// ---------------------------------------------------------------------------

export interface SkylineBandProps {
  className?: string;
  /** Silhouette colour. Pass 'currentColor' to inherit from the parent. */
  fill?: string;
  /** Lit-window colour. Pass `null` to drop the windows entirely. */
  accent?: string | null;
}

/**
 * A wide, low silhouette — a section divider, or the base of a hero. Sits
 * flush on its bottom edge, so give it `w-full` and let the height ride.
 */
export function SkylineBand({
  className = '',
  fill = MIDNIGHT,
  accent = GOLDENROD,
}: SkylineBandProps) {
  return (
    <svg
      viewBox="0 0 1200 190"
      preserveAspectRatio="xMidYMax meet"
      role="presentation"
      aria-hidden
      focusable="false"
      className={className}
    >
      <g fill={fill}>
        {SKYLINE.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      {accent && (
        <g fill={accent}>
          {LIT_WINDOWS.map(([x, y], i) => (
            <rect key={i} x={x} y={y} width={5} height={6} />
          ))}
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SkylineHero
// ---------------------------------------------------------------------------

export interface SkylineHeroProps {
  className?: string;
  /** Escape hatch for masks and blend modes the caller needs to control. */
  style?: CSSProperties;
  /** Background plane colour (the sky). Pass `null` for a transparent sky. */
  sky?: string | null;
}

/**
 * Three planes of Midnight — distant spires, the detailed midground row, and
 * chunky near blocks — for the space behind a hero. Depth comes from tone and
 * overlap, so it reads as a city even at 120px tall.
 */
export function SkylineHero({ className = '', sky = null, style }: SkylineHeroProps) {
  return (
    <svg
      viewBox="0 0 1200 262"
      preserveAspectRatio="xMidYMax slice"
      role="presentation"
      aria-hidden
      focusable="false"
      className={className}
      style={style}
    >
      <defs>
        <linearGradient id="cresa-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={MIDNIGHT} stopOpacity="0" />
          <stop offset="100%" stopColor={MIDNIGHT} stopOpacity="0.14" />
        </linearGradient>
        <linearGradient id="cresa-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={GOLDENROD} stopOpacity="0.16" />
          <stop offset="100%" stopColor={GOLDENROD} stopOpacity="0" />
        </linearGradient>
      </defs>

      {sky && <rect x="0" y="0" width="1200" height="262" fill={sky} />}
      <rect x="0" y="0" width="1200" height="262" fill="url(#cresa-sky)" />

      {/* Back plane — distant, lightest, mostly spires. */}
      <g fill={MIDNIGHT_400} opacity="0.55">
        {FAR_SKYLINE.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>

      {/* A low band of warm haze where the towers meet the street. */}
      <rect x="0" y="150" width="1200" height="70" fill="url(#cresa-haze)" />

      {/* Midground — the recognisable row, dropped onto the same baseline. */}
      <g transform="translate(0 60)">
        <g fill={STADIUM}>
          {SKYLINE.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <g fill={GOLDENROD}>
          {LIT_WINDOWS.map(([x, y], i) => (
            <rect key={i} x={x} y={y} width={5} height={6} />
          ))}
        </g>
      </g>

      {/* Front plane — nearest, darkest, deliberately plain. */}
      <g fill={MIDNIGHT}>
        {NEAR_BLOCKS.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g fill={GOLDENROD} opacity="0.85">
        {[
          [286, 178], [298, 178],
          [576, 182], [590, 182],
          [870, 180], [884, 180],
        ].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width={6} height={7} />
        ))}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// TowerMark
// ---------------------------------------------------------------------------

export interface TowerMarkProps {
  className?: string;
  /** Height in CSS pixels. Width follows the aspect ratio. */
  size?: number;
  fill?: string;
  /** Colour of the highlighted floors — the same idea as the map. */
  accent?: string;
}

/** Floors drawn as bands on the shaft. `true` marks an available floor. */
const TOWER_FLOORS: { y: number; x: number; w: number; lit: boolean }[] = [
  { y: 48, x: 44, w: 32, lit: false },
  { y: 58, x: 44, w: 32, lit: true },
  { y: 76, x: 34, w: 52, lit: false },
  { y: 86, x: 34, w: 52, lit: false },
  { y: 104, x: 24, w: 72, lit: false },
  { y: 116, x: 24, w: 72, lit: true },
  { y: 128, x: 24, w: 72, lit: false },
  { y: 140, x: 24, w: 72, lit: false },
  { y: 152, x: 24, w: 72, lit: true },
  { y: 164, x: 24, w: 72, lit: false },
  { y: 176, x: 24, w: 72, lit: false },
  { y: 188, x: 24, w: 72, lit: false },
];

/**
 * A single stylised tower with its available floors picked out in Goldenrod —
 * the same reading as the 3D map. Built for empty states, where it has to say
 * "a building with space in it" at a glance.
 */
export function TowerMark({
  className = '',
  size = 96,
  fill = MIDNIGHT,
  accent = GOLDENROD,
}: TowerMarkProps) {
  return (
    <svg
      viewBox="0 0 120 210"
      width={(size * 120) / 210}
      height={size}
      role="presentation"
      aria-hidden
      focusable="false"
      className={className}
    >
      {/* Shaft: three setbacks and a mast. */}
      <path
        fill={fill}
        d="M18 206 V96 H30 V72 H40 V44 H80 V72 H90 V96 H102 V206 Z
           M56 44 H64 V28 H62 V14 H61 V6 H59 V14 H58 V28 H56 Z"
      />
      {/* Floor lines. The lit ones are the point; the rest give it scale. */}
      {TOWER_FLOORS.map((f, i) => (
        <rect
          key={i}
          x={f.x}
          y={f.y}
          width={f.w}
          height={f.lit ? 7 : 3}
          fill={f.lit ? accent : '#FFFFFF'}
          opacity={f.lit ? 1 : 0.16}
        />
      ))}
      {/* Ground line. */}
      <rect x="6" y="206" width="108" height="4" fill={fill} opacity="0.35" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// GridPattern
// ---------------------------------------------------------------------------

export interface GridPatternProps {
  className?: string;
  /** Distance between dots, in SVG user units. */
  spacing?: number;
  /** Dot radius. */
  dotSize?: number;
  /** Dot colour. Defaults to `currentColor` so it inherits from the parent. */
  color?: string;
  opacity?: number;
  /**
   * Pattern id. The default is deterministic — two instances with identical
   * geometry share a definition harmlessly. Override it when two different
   * grids are on the same page.
   */
  id?: string;
}

/**
 * The Cresa dot motif as a tiling background. Absolutely position it inside a
 * relative container and give it `inset-0`.
 */
export function GridPattern({
  className = '',
  spacing = 24,
  dotSize = 1.5,
  color = 'currentColor',
  opacity = 0.18,
  id = 'cresa-dot-grid',
}: GridPatternProps) {
  return (
    <svg
      role="presentation"
      aria-hidden
      focusable="false"
      className={className}
      width="100%"
      height="100%"
    >
      <defs>
        <pattern id={id} width={spacing} height={spacing} patternUnits="userSpaceOnUse">
          <circle cx={dotSize} cy={dotSize} r={dotSize} fill={color} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} opacity={opacity} />
    </svg>
  );
}

export default SkylineBand;
