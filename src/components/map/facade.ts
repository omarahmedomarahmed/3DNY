import { LayerExtension } from '@deck.gl/core';

/**
 * What a building's wall is made of.
 *
 * The floor plates are geometry, because they need each building's real floor
 * height and have to line up exactly with the availability bands. Everything
 * else a facade does is texture, and drawing texture as geometry would mean
 * thousands of thin boxes threaded along every footprint edge. So it is a
 * shader: no extra vertices at all, and it stays crisp at every zoom because
 * the spacing is computed per pixel.
 *
 * Three things, each doing a different job:
 *
 * 1. **Mullions.** Vertical curtain-wall modules. This is what stops an
 *    extrusion reading as a solid coloured block.
 * 2. **Piers.** Every few modules, a heavier vertical. Real towers are not an
 *    even comb of identical lines — they have structure at intervals, and it
 *    is the rhythm of heavy against light that reads as a building rather
 *    than as a hatch pattern.
 * 3. **Vertical shading.** A wall is darker where it sits in the street's
 *    shade and lighter where it faces open sky, and glass gets brighter as it
 *    picks up more sky toward the top. This is the single cheapest thing that
 *    makes a tower look like it is standing in a city rather than floating.
 *
 * Four details make this work on `SolidPolygonLayer` specifically:
 *
 * - Only side faces get any of it. The side vertex shader defines
 *   IS_SIDE_VERTEX, so everything touching wall-only attributes hides behind
 *   that guard. Roofs, and any sublayer that is not the extruded fill, fall
 *   through to a sentinel and draw nothing.
 * - Module spacing is in metres, not in fractions of a wall. `positions.x`
 *   runs 0..1 along an edge, so a fraction would put six mullions on a 4m
 *   return and six on a 60m frontage. The edge is measured in the vertex
 *   shader and the coordinate handed to the fragment stage is already in
 *   module widths.
 * - Height comes from `positions.y`, which is 0 at the base of a wall and 1 at
 *   its top — the same trick, one axis over.
 * - Lines are drawn with a derivative-based width rather than a fixed one, so
 *   they stay hairlines as the camera pulls back instead of turning the facade
 *   into a solid block of mullion.
 *
 * And one rule that is not about looks at all: the fragment hook this injects
 * into is the same one deck.gl uses to emit picking colours, so the whole
 * effect switches itself off while picking is active. Getting this wrong does
 * not look wrong — it just silently stops buildings being clickable, which has
 * happened here twice.
 */

export interface FacadeExtensionProps {
  /**
   * Curtain-wall module, in metres. A real bay is nearer 1.5m, but at the
   * distance this map is actually read from that is finer than a pixel and
   * fades to nothing — 2.2m keeps the grain legible without inventing a
   * building that could not exist.
   */
  spacingM?: number;
  /** 0-1. How strongly a mullion darkens (or lightens) the wall. */
  strength?: number;
  /** True on the dark map, where a mullion reads as a lit edge, not a shadow. */
  lighten?: boolean;
  /** Modules between structural piers. 0 turns piers off. */
  pierEvery?: number;
  /** 0-1. How much darker the base of a wall is than its top. */
  gradient?: number;
}

const DEFAULTS: Required<FacadeExtensionProps> = {
  spacingM: 2.2,
  strength: 0.45,
  lighten: false,
  pierEvery: 5,
  gradient: 0.3,
};

export class FacadeExtension extends LayerExtension<Required<FacadeExtensionProps>> {
  static extensionName = 'FacadeExtension';

  constructor(props: FacadeExtensionProps = {}) {
    super({ ...DEFAULTS, ...props });
  }

  // deck.gl calls this with the LAYER as `this` and the extension instance as
  // the argument, so the options come from `extension`, never from `this`.
  getShaders(extension: FacadeExtension) {
    const { spacingM, strength, lighten, pierEvery, gradient } = extension.opts;
    // Baked into the source rather than plumbed as uniforms: these change only
    // with the theme, which already rebuilds the layers.
    const spacing = spacingM.toFixed(3);
    const amount = strength.toFixed(3);
    const factor = lighten ? '1.55' : '0.62';
    const grad = gradient.toFixed(3);

    // Whether piers exist is decided HERE, in JavaScript, and the block is
    // either in the source or it is not.
    //
    // The obvious-looking `#if ${piers} > 0.5` does not work: GLSL's
    // preprocessor only evaluates integer constant expressions, so a float
    // comparison makes the whole fragment shader fail to compile — and a
    // failed compile does not throw anywhere useful, it just leaves the
    // buildings unrendered with a link error in the console.
    const piers = Math.max(0, Math.round(pierEvery));
    const pierSource =
      piers > 0
        ? `
    float pierCoord = deckgl_mullion / ${piers.toFixed(1)};
    float pierFract = fract(pierCoord);
    float pierDist = min(pierFract, 1.0 - pierFract);
    float pierStep = fwidth(pierCoord);
    pierLine = 1.0 - smoothstep(0.0, max(pierStep * 1.4, 0.02), pierDist);
    // Piers survive to a wider zoom than mullions, being wider themselves.
    pierLine *= 1.0 - smoothstep(0.5, 1.1, pierStep);`
        : '';

    return {
      inject: {
        'vs:#decl': `
out float deckgl_mullion;
out float deckgl_facadeUp;
`,
        'vs:DECKGL_FILTER_COLOR': `
  // Sentinel: anything that is not an extruded wall draws no facade.
  deckgl_mullion = -1.0;
  deckgl_facadeUp = 0.0;
#ifdef IS_SIDE_VERTEX
  // Metres per degree, with longitude corrected for latitude, so a module is
  // the same width on a north-facing wall as on an east-facing one.
  float mullionLat = radians(vertexPositions.y);
  float mullionDx =
    (nextVertexPositions.x - vertexPositions.x) * cos(mullionLat) * 111320.0;
  float mullionDy = (nextVertexPositions.y - vertexPositions.y) * 111320.0;
  float mullionEdge = sqrt(mullionDx * mullionDx + mullionDy * mullionDy);
  deckgl_mullion = positions.x * mullionEdge / ${spacing};
  // 0 at the base of the wall, 1 at the top.
  deckgl_facadeUp = positions.y;
#endif
`,
        'fs:#decl': `
in float deckgl_mullion;
in float deckgl_facadeUp;
`,
        'fs:DECKGL_FILTER_COLOR': `
  // NEVER touch the colour during a picking pass. deck.gl encodes each object
  // as an exact RGB value and reads it back from the framebuffer; shading that
  // value even slightly makes it decode to a different object, or to none —
  // which is exactly how clicking on buildings broke here, twice.
  if (deckgl_mullion >= 0.0 && !bool(picking.isActive)) {
    // --- Vertical shading. Darker where the wall sits in the street's shade,
    // brighter where it faces open sky. Applied before the lines so the lines
    // ride on top of the shading rather than being flattened by it.
    float facadeShade = mix(1.0 - ${grad}, 1.0 + ${grad} * 0.35, deckgl_facadeUp);
    color.rgb *= facadeShade;

    float mullionStep = fwidth(deckgl_mullion);
    // One module per pixel or denser means the wall is past resolving: fade
    // the whole effect out rather than aliasing it into moire.
    float mullionFade = 1.0 - smoothstep(0.34, 0.72, mullionStep);

    // --- Mullions: the even comb of curtain-wall modules.
    float mullionFract = fract(deckgl_mullion);
    // Distance to the nearest module edge, wrapped so both sides of a line
    // are treated alike.
    float mullionDist = min(mullionFract, 1.0 - mullionFract);
    float mullionLine =
      1.0 - smoothstep(0.0, max(mullionStep * 1.1, 0.012), mullionDist);

    // --- Piers: a heavier vertical every few modules. Without these the comb
    // reads as hatching; with them it reads as structure.
    float pierLine = 0.0;
${pierSource}
    float facadeLine = max(mullionLine * mullionFade, pierLine * 0.85);
    color.rgb = mix(color.rgb, color.rgb * ${factor}, facadeLine * ${amount});
  }
`,
      },
    };
  }
}

/**
 * One instance per theme, so the shader source is compiled once each.
 *
 * The dark map lightens its lines — a mullion at night reads as a lit edge,
 * not a shadow — and takes a stronger vertical gradient, because a dark tower
 * with no gradient is a silhouette with nothing in it.
 */
export const FACADE_DARK = new FacadeExtension({
  lighten: true,
  strength: 0.4,
  gradient: 0.34,
});

export const FACADE_LIGHT = new FacadeExtension({
  lighten: false,
  strength: 0.45,
  gradient: 0.24,
});

/**
 * The surrounding grey city, which needs less of everything.
 *
 * It is scenery: it should read as built rather than blank, without acquiring
 * enough detail to compete with the buildings that carry data.
 */
export const FACADE_CONTEXT_DARK = new FacadeExtension({
  lighten: true,
  strength: 0.26,
  // Deliberately gentler than the buildings that carry data. At the full
  // strength the towers use, the lower half of every grey building sank into
  // the ground on the dark map and the city read as one dark mass rather than
  // as a city.
  gradient: 0.15,
  pierEvery: 0,
});

export const FACADE_CONTEXT_LIGHT = new FacadeExtension({
  lighten: false,
  strength: 0.3,
  gradient: 0.2,
  pierEvery: 0,
});
