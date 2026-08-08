import { LayerExtension } from '@deck.gl/core';

/**
 * Vertical mullions on building walls — the other half of a curtain wall.
 *
 * The floor plates are geometry, because they need each building's real floor
 * height and had to line up exactly with the availability bands. Mullions have
 * no such requirement: they are pure texture, and drawing them as geometry
 * would mean thousands of thin boxes threaded along every footprint edge. So
 * they are a shader instead — no extra vertices at all, and they stay crisp at
 * every zoom because the spacing is computed per pixel.
 *
 * Three details make this work on `SolidPolygonLayer` specifically:
 *
 * 1. Only side faces get them. The side vertex shader defines IS_SIDE_VERTEX,
 *    so everything that touches wall-only attributes hides behind that guard.
 *    Roofs, and any sublayer that is not the extruded fill, fall through to a
 *    sentinel and draw nothing.
 * 2. Spacing is in metres, not in fractions of a wall. `positions.x` runs 0..1
 *    along an edge, so a fraction would put six mullions on a 4m return and
 *    six on a 60m frontage. The edge is measured in the vertex shader and the
 *    coordinate handed to the fragment stage is already in module widths.
 * 3. The line is drawn with a derivative-based width rather than a fixed one,
 *    so it stays a hairline as the camera pulls back instead of turning the
 *    facade into a solid block of mullion.
 *
 * And one rule that is not about looks at all: the fragment hook this injects
 * into is the same one deck.gl uses to emit picking colours, so the effect has
 * to switch itself off while picking is active.
 */

export interface MullionExtensionProps {
  /**
   * Curtain-wall module, in metres. A real bay is nearer 1.5m, but at the
   * distance this map is actually read from that is finer than a pixel and
   * fades to nothing — 2.2m keeps the grain legible without inventing a
   * building that could not exist.
   */
  spacingM?: number;
  /** 0-1. How strongly the mullion darkens (or lightens) the wall. */
  strength?: number;
  /** True on the dark map, where a mullion reads as a lit edge, not a shadow. */
  lighten?: boolean;
}

const DEFAULTS: Required<MullionExtensionProps> = {
  spacingM: 2.2,
  strength: 0.45,
  lighten: false,
};

export class MullionExtension extends LayerExtension<Required<MullionExtensionProps>> {
  static extensionName = 'MullionExtension';

  constructor(props: MullionExtensionProps = {}) {
    super({ ...DEFAULTS, ...props });
  }

  // deck.gl calls this with the LAYER as `this` and the extension instance as
  // the argument, so the options come from `extension`, never from `this`.
  getShaders(extension: MullionExtension) {
    const { spacingM, strength, lighten } = extension.opts;
    // Baked into the source rather than plumbed as uniforms: these change only
    // with the theme, which already rebuilds the layers.
    const spacing = spacingM.toFixed(3);
    const amount = strength.toFixed(3);
    const factor = lighten ? '1.55' : '0.62';

    return {
      inject: {
        'vs:#decl': `
out float deckgl_mullion;
`,
        'vs:DECKGL_FILTER_COLOR': `
  // Sentinel: anything that is not an extruded wall draws no mullions.
  deckgl_mullion = -1.0;
#ifdef IS_SIDE_VERTEX
  // Metres per degree, with longitude corrected for latitude, so a module is
  // the same width on a north-facing wall as on an east-facing one.
  float mullionLat = radians(vertexPositions.y);
  float mullionDx =
    (nextVertexPositions.x - vertexPositions.x) * cos(mullionLat) * 111320.0;
  float mullionDy = (nextVertexPositions.y - vertexPositions.y) * 111320.0;
  float mullionEdge = sqrt(mullionDx * mullionDx + mullionDy * mullionDy);
  deckgl_mullion = positions.x * mullionEdge / ${spacing};
#endif
`,
        'fs:#decl': `
in float deckgl_mullion;
`,
        'fs:DECKGL_FILTER_COLOR': `
  // NEVER touch the colour during a picking pass. deck.gl encodes each object
  // as an exact RGB value and reads it back from the framebuffer; shading that
  // value even slightly makes it decode to a different object, or to none —
  // which is exactly how this broke clicking on buildings.
  if (deckgl_mullion >= 0.0 && !bool(picking.isActive)) {
    float mullionFract = fract(deckgl_mullion);
    // Distance to the nearest module edge, wrapped so both sides of a line
    // are treated alike.
    float mullionDist = min(mullionFract, 1.0 - mullionFract);
    // One module per pixel or denser means the wall is past resolving: fade
    // the whole effect out rather than aliasing it into moire.
    float mullionStep = fwidth(deckgl_mullion);
    float mullionFade = 1.0 - smoothstep(0.34, 0.72, mullionStep);
    float mullionLine =
      1.0 - smoothstep(0.0, max(mullionStep * 1.1, 0.012), mullionDist);
    color.rgb = mix(
      color.rgb,
      color.rgb * ${factor},
      mullionLine * mullionFade * ${amount}
    );
  }
`,
      },
    };
  }
}

/** One instance per theme, so the shader source is compiled once each. */
export const MULLIONS_DARK = new MullionExtension({ lighten: true, strength: 0.4 });
export const MULLIONS_LIGHT = new MullionExtension({ lighten: false, strength: 0.45 });
