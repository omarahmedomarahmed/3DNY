import { LayerExtension } from '@deck.gl/core';
import type { RGB } from './colors';

/**
 * Air.
 *
 * A city model with no atmosphere reads as a diagram no matter how good the
 * geometry is, because the one cue the eye uses for depth in a real view is
 * missing: things far away are paler, bluer and lower in contrast than things
 * close to hand. Sky and haze are what turn a field of extruded boxes into
 * somewhere with distance in it.
 *
 * Two halves, because the frame has two halves:
 *
 *   - The sky above the horizon is MapLibre's, set through its own `sky`
 *     specification. It costs us no geometry and it lines up exactly with the
 *     horizon MapLibre already computes for the current pitch.
 *   - The haze on everything below the horizon is ours, injected into the
 *     buildings' own fragment shader, because only we know how far each
 *     fragment is from the camera.
 *
 * And the rule that governs every shader in this project:
 *
 *   **Never touch the fragment colour during a picking pass.** deck.gl encodes
 *   each object as an exact RGB value and reads it back out of the
 *   framebuffer. Tinting that value even slightly makes it decode to a
 *   different object, or to none. That is how building clicks broke here
 *   twice, and haze is exactly the kind of subtle whole-scene effect that
 *   would do it silently — everything would look right and nothing would be
 *   clickable.
 */

export interface AtmospherePreset {
  key: TimeOfDay;
  label: string;
  /** Directly overhead is midday; the sun's own position drives the light. */
  timestamp: number;
  /** Sky above the horizon. */
  sky: string;
  /** The band where sky meets ground. */
  horizon: string;
  /** What distant geometry fades toward. Matches the horizon, or haze reads as a filter. */
  haze: RGB;
  /** 0-1. How completely the farthest geometry dissolves into the air. */
  hazeStrength: number;
  /** Ambient and sun intensities, so dusk is not merely a colder midday. */
  ambient: number;
  sun: number;
  sunColor: RGB;
}

export type TimeOfDay = 'morning' | 'midday' | 'golden' | 'night';

/**
 * Four hours of the day, each a real sun position over Manhattan.
 *
 * The timestamps are what `_SunLight` derives its direction from, so the lit
 * and shaded faces of a tower are where they would actually be at that hour —
 * and because the direction is fixed in the world rather than to the camera,
 * orbiting the map feels like walking around a model.
 */
export const ATMOSPHERE: Record<TimeOfDay, AtmospherePreset> = {
  morning: {
    key: 'morning',
    label: 'Morning',
    // Mid-morning in June: the sun is high enough that the avenues are not in
    // shadow, far enough east that towers throw long readable shadows.
    timestamp: Date.UTC(2025, 5, 21, 14, 30),
    sky: '#8FB4E4',
    horizon: '#CFDEF0',
    haze: [193, 212, 235],
    hazeStrength: 0.72,
    ambient: 1.05,
    sun: 0.68,
    sunColor: [255, 250, 238],
  },
  midday: {
    key: 'midday',
    label: 'Midday',
    timestamp: Date.UTC(2025, 5, 21, 17, 0),
    sky: '#77A6E0',
    horizon: '#D6E4F2',
    haze: [203, 219, 238],
    hazeStrength: 0.62,
    ambient: 1.18,
    sun: 0.62,
    sunColor: [255, 253, 246],
  },
  golden: {
    key: 'golden',
    label: 'Golden hour',
    // Low western sun: the hour where a skyline earns its silhouette.
    timestamp: Date.UTC(2025, 5, 21, 23, 15),
    sky: '#6E8DC4',
    horizon: '#F0C89A',
    haze: [222, 190, 163],
    hazeStrength: 0.8,
    ambient: 0.92,
    sun: 0.78,
    sunColor: [255, 226, 186],
  },
  night: {
    key: 'night',
    label: 'Night',
    timestamp: Date.UTC(2025, 5, 22, 5, 0),
    sky: '#050A16',
    horizon: '#16233C',
    haze: [16, 26, 45],
    hazeStrength: 0.85,
    ambient: 0.95,
    sun: 0.34,
    sunColor: [176, 196, 232],
  },
};

/** Which hour a theme opens at. Dark rooms get night; the light map gets day. */
export const DEFAULT_TIME: Record<'dark' | 'light', TimeOfDay> = {
  dark: 'night',
  light: 'morning',
};

export const TIME_ORDER: TimeOfDay[] = ['morning', 'midday', 'golden', 'night'];

/**
 * MapLibre's sky and fog for a preset.
 *
 * `atmosphere-blend` is deliberately below 1: at full strength the sky washes
 * over the top of the tallest towers at high pitch, and a tower dissolving
 * into the sky it is standing against is the one place this effect would cost
 * more legibility than it buys.
 */
export function skySpec(preset: AtmospherePreset) {
  return {
    'sky-color': preset.sky,
    'horizon-color': preset.horizon,
    'fog-color': preset.horizon,
    // How far up from the ground the fog reaches before the horizon band.
    'fog-ground-blend': 0.6,
    'horizon-fog-blend': 0.62,
    'sky-horizon-blend': 0.72,
    'atmosphere-blend': 0.78,
  };
}

export interface HazeExtensionProps {
  /** What distance fades toward — the horizon colour, as 0-255 RGB. */
  color?: RGB;
  /** 0-1. How completely the farthest geometry dissolves. */
  strength?: number;
  /**
   * Metres at which haze begins. Nothing inside this is touched at all, which
   * is what keeps the building being discussed at full contrast.
   */
  startM?: number;
  /** Metres at which haze reaches full strength. */
  endM?: number;
}

const HAZE_DEFAULTS: Required<HazeExtensionProps> = {
  color: [200, 216, 236],
  strength: 0.7,
  startM: 700,
  endM: 6200,
};

/**
 * Distance haze, as a shader on whatever it is attached to.
 *
 * Depth is read from the fragment's own position in deck.gl's common space
 * rather than from a depth texture, so this needs no extra pass and no
 * framebuffer — it is a handful of instructions on geometry that is being
 * rasterised anyway.
 *
 * The near cutoff matters more than it looks. Haze that starts at the camera
 * would take a few percent of contrast off the building a broker is pointing
 * at, and the whole point of this map is that the building being pointed at is
 * unambiguous. So the near field is untouched and only genuine distance fades.
 */
export class HazeExtension extends LayerExtension<Required<HazeExtensionProps>> {
  static extensionName = 'HazeExtension';

  constructor(props: HazeExtensionProps = {}) {
    super({ ...HAZE_DEFAULTS, ...props });
  }

  // deck.gl calls this with the LAYER as `this` and the extension instance as
  // the argument. Reading options off `this` compiles and silently does
  // nothing, which is its own trap.
  getShaders(extension: HazeExtension) {
    const { color, strength, startM, endM } = extension.opts;
    const r = (color[0] / 255).toFixed(4);
    const g = (color[1] / 255).toFixed(4);
    const b = (color[2] / 255).toFixed(4);
    const amount = strength.toFixed(3);
    const near = startM.toFixed(1);
    const far = Math.max(endM, startM + 1).toFixed(1);

    return {
      inject: {
        'vs:#decl': `
out float deckgl_hazeDist;
`,
        // Distance from the camera to this vertex, in metres. `project_size`
        // converts deck.gl's common units back to metres at this latitude, so
        // the same haze band means the same real distance at every zoom.
        'vs:DECKGL_FILTER_COLOR': `
  deckgl_hazeDist = length(geometry.position.xyz - project.cameraPosition) / project_size(1.0);
`,
        'fs:#decl': `
in float deckgl_hazeDist;
`,
        'fs:DECKGL_FILTER_COLOR': `
  // NEVER during picking. deck.gl reads object ids back as exact RGB values,
  // and a hazed id decodes to the wrong object or to none — which is how
  // building clicks have broken here before.
  if (!bool(picking.isActive)) {
    float hazeT = smoothstep(${near}, ${far}, deckgl_hazeDist);
    color.rgb = mix(color.rgb, vec3(${r}, ${g}, ${b}), hazeT * ${amount});
  }
`,
      },
    };
  }
}

/**
 * Haze extensions are cached per distinct appearance.
 *
 * The shader source is baked from the options, so a fresh instance per render
 * means a fresh program and a recompile on every frame the camera moves. There
 * are only a handful of distinct presets, so they are memoised by their own
 * parameters.
 */
const hazeCache = new Map<string, HazeExtension>();

export function hazeFor(preset: AtmospherePreset, scale = 1): HazeExtension {
  const strength = Math.max(0, Math.min(1, preset.hazeStrength * scale));
  const key = `${preset.haze.join(',')}|${strength.toFixed(3)}`;
  let ext = hazeCache.get(key);
  if (!ext) {
    ext = new HazeExtension({ color: preset.haze, strength });
    hazeCache.set(key, ext);
  }
  return ext;
}
