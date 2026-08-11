import * as THREE from 'three';
import type { AtmospherePreset } from '../map/atmosphere';

/**
 * What a building is made of in Explore mode.
 *
 * The art direction is VU.CITY and the whole of it is in the surfaces: a city
 * that is almost colourless, so that Goldenrod is the only shouted thing in
 * the frame. Concretely, three materials and one rule.
 *
 * | Material | Reads as |
 * |---|---|
 * | Facade | Near-white warm grey pier and spandrel, with real glass between |
 * | Massing | The same stone with no fenestration — context city, and anything too far to resolve |
 * | Ground | Pale roadbed, no grime, no decals |
 *
 * **The rule:** a Goldenrod band stays the loudest thing on screen, and on a
 * near-white city that is won on *chroma* rather than on brightness — which is
 * why the city has no colour in it. What would break it is a blown specular:
 * a hard-edged white highlight sliding across a glass flank competes with a
 * band in a way a flat pale wall never does. `MAX_FACADE_LUMA` exists for that
 * case and is enforced in the shader rather than eyeballed.
 *
 * Everything is procedural: no textures ship, no image is downloaded, and a
 * building added tomorrow gets the same treatment with no new asset. A
 * photographic facade is explicitly rejected by the plan, and it fails at
 * precisely the moment this mode exists for — walking up to the window.
 */

/**
 * The ceiling on how bright any facade pixel is allowed to get.
 *
 * Goldenrod `#FFB600` lands at 0.72 on this scale. A near-white city is
 * necessarily brighter than that in places, and that is fine and intended —
 * what makes a band the loudest thing on a pale city is its *chroma*, not its
 * luminance, which is the whole reason the art direction asks for a city with
 * no colour in it.
 *
 * What is NOT fine is a specular highlight clipping to white. A blown
 * highlight on a glass flank is a large, hard-edged, moving bright shape, and
 * it competes with a band in a way a flat pale wall never does. So the clamp
 * sits just below white and its real job is the sun on the glass.
 *
 * Note these are display-referred values, not linear ones. The renderer is
 * configured for no tone mapping and no sRGB encode (see `ExploreLayer`),
 * because deck.gl and MapLibre both write display values directly and Explore
 * mode has to composite with them rather than beside them. A shader here that
 * reasoned in linear light would render the city about a stop and a half too
 * dark — which is exactly what the first version of this did.
 */
export const MAX_FACADE_LUMA = 0.86;

export interface FacadeUniforms {
  uSunDir: THREE.Vector3;
  uSunColor: THREE.Color;
  uSunIntensity: number;
  uAmbient: number;
  uSkyColor: THREE.Color;
  uHorizonColor: THREE.Color;
  uHazeColor: THREE.Color;
  uHazeStrength: number;
  /** Metres, from the building's own ground. Sets the window grid's rhythm. */
  uFloorHeight: number;
  /** Metres. Curtain-wall bay width. */
  uBayWidth: number;
  /** 0-1. How much of the storey is glass rather than spandrel. */
  uGlassFraction: number;
  /** Stone colour. Near-white, faintly warm. */
  uStoneColor: THREE.Color;
  /** Glass tint, before reflection. */
  uGlassColor: THREE.Color;
  /** Camera position in scene metres — reflections and haze both need it. */
  uCameraPos: THREE.Vector3;
  /** Rises above zero when interiors are switched on. Sprint 7 uses it. */
  uInterior: number;
  /** Seconds, for anything that has to move. */
  uTime: number;
}

/**
 * Shared GLSL. The sky is analytic rather than a cubemap: it costs no texture,
 * no download and no load-order problem, and it can be derived from the same
 * `AtmospherePreset` the flat map's sky already uses — so the reflection in a
 * window is the sky that is actually above it at that hour.
 */
const SKY_GLSL = /* glsl */ `
  vec3 skyColor(vec3 dir) {
    // Up is +Z in this scene. The horizon band is compressed toward it so a
    // reflection at a shallow angle picks up horizon rather than zenith,
    // which is what makes glass read as glass at street level.
    float t = clamp(dir.z * 0.5 + 0.5, 0.0, 1.0);
    float band = pow(clamp(1.0 - abs(dir.z), 0.0, 1.0), 3.0);
    vec3 base = mix(uHorizonColor, uSkyColor, smoothstep(0.48, 0.86, t));
    return mix(base, uHorizonColor, band * 0.55);
  }

  /** Relative luminance, Rec. 709. */
  float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }

  /**
   * The one rule, in code: no surface out-shouts a Goldenrod band.
   *
   * Scaling rather than clamping per channel, so a bright wall desaturates
   * toward its own hue instead of shifting toward whichever channel clipped
   * first. A per-channel clamp turned warm stone green under a low sun.
   */
  vec3 holdBelowBand(vec3 c, float ceiling) {
    float l = luma(c);
    return l > ceiling ? c * (ceiling / max(l, 1e-4)) : c;
  }
`;

const HAZE_GLSL = /* glsl */ `
  vec3 applyHaze(vec3 c, float dist) {
    // Matches the flat map's HazeExtension: nothing inside 700 m is touched,
    // so the building being pointed at is never softened.
    float t = smoothstep(700.0, 6200.0, dist);
    return mix(c, uHazeColor, t * uHazeStrength);
  }
`;

const FACADE_VERTEX = /* glsl */ `
  attribute float along;
  attribute float up;
  attribute float wall;
  attribute float isWall;

  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vAlong;
  varying float vUp;
  varying float vWall;
  varying float vIsWall;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vAlong = along;
    vUp = up;
    vWall = wall;
    vIsWall = isWall;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * The facade.
 *
 * One storey is a row of bays. One bay is a pier, a mullion, a pane of glass
 * and a spandrel under it — the four things a curtain wall is actually made
 * of, and the reason a building reads as a building rather than as a striped
 * box.
 *
 * Everything is measured in metres and antialiased with screen-space
 * derivatives, so the grid stays crisp when the camera is against the glass
 * and dissolves into flat stone when the building is six blocks away. That
 * dissolve is not a nicety: an unfiltered window grid at distance is a moiré
 * field, and moiré is bright, which puts it in competition with the bands.
 */
const FACADE_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;
  uniform float uAmbient;
  uniform vec3 uSkyColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uHazeColor;
  uniform float uHazeStrength;
  uniform float uFloorHeight;
  uniform float uBayWidth;
  uniform float uGlassFraction;
  uniform vec3 uStoneColor;
  uniform vec3 uGlassColor;
  uniform vec3 uCameraPos;
  uniform float uInterior;
  uniform float uTime;
  uniform float uSeed;

  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vAlong;
  varying float vUp;
  varying float vWall;
  varying float vIsWall;

  ${SKY_GLSL}
  ${HAZE_GLSL}

  /** Deterministic per-cell noise. The same window is lit every time. */
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21) + uSeed);
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCameraPos - vWorld);
    float dist = length(uCameraPos - vWorld);

    vec3 albedo = uStoneColor;
    float glass = 0.0;
    vec3 roomLight = vec3(0.0);

    if (vIsWall > 0.5) {
      float bay = vAlong / uBayWidth;
      float storey = vUp / uFloorHeight;
      float bayF = fract(bay);
      float storeyF = fract(storey);

      // Fade the whole grid out once a bay approaches a pixel wide. Below
      // that it is aliasing, and aliasing is loud.
      float bayPx = fwidth(bay);
      float storeyPx = fwidth(storey);
      float resolve = 1.0 - smoothstep(0.30, 0.70, max(bayPx, storeyPx));

      /**
       * A bay, in four parts, which is what a curtain wall is made of.
       *
       * | Part | Where |
       * |---|---|
       * | Spandrel | The bottom of the storey, under the sill |
       * | Mullion | The vertical between one pane and the next |
       * | Transom | The horizontal at the head of the pane |
       * | Pane | What is left, and the only part that is glass |
       *
       * The mullion is a fixed 90 mm rather than a fraction of the bay, so a
       * narrow bay does not get a proportionally narrow mullion. Real curtain
       * wall is made of extrusions that come in one size.
       */
      float mullionM = 0.09;
      float mullion = mullionM / uBayWidth;
      float sill = 1.0 - uGlassFraction;
      float head = 0.96;

      float aaX = max(bayPx * 1.2, 0.012);
      float aaY = max(storeyPx * 1.2, 0.012);

      float paneX = smoothstep(mullion, mullion + aaX, bayF) *
                    (1.0 - smoothstep(1.0 - mullion - aaX, 1.0 - mullion, bayF));
      float paneY = smoothstep(sill, sill + aaY, storeyF) *
                    (1.0 - smoothstep(head - aaY, head, storeyF));
      glass = paneX * paneY * resolve;

      /**
       * The pane is divided, because real ones are.
       *
       * A single sheet of glass a storey tall and a bay wide exists on very
       * few buildings; almost every curtain wall has a horizontal transom
       * about two thirds up and many have a vertical centre mullion. Without
       * them a glass tower reads as shrink-wrapped, which is the specific way
       * procedural facades look fake.
       */
      float transom = 1.0 - smoothstep(0.0, max(aaY * 0.9, 0.008),
                                       abs(storeyF - mix(sill, head, 0.62)));
      float centre = 1.0 - smoothstep(0.0, max(aaX * 0.9, 0.008), abs(bayF - 0.5));
      float divider = max(transom, centre * 0.7) * glass * resolve;

      // --- Piers. A heavier vertical every fifth bay: what stops the grid
      // reading as hatching and starts it reading as structure.
      float pierCoord = bay / 5.0;
      float pierPx = fwidth(pierCoord);
      float pier = 1.0 - smoothstep(0.0, max(pierPx * 1.6, 0.03),
                                    min(fract(pierCoord), 1.0 - fract(pierCoord)));
      pier *= 1.0 - smoothstep(0.5, 1.1, pierPx);

      // --- The slab edge between one storey and the next.
      float slab = 1.0 - smoothstep(0.0, max(aaY, 0.02),
                                    min(storeyF, 1.0 - storeyF));

      /**
       * The spandrel is a different material from the pier.
       *
       * On a real building the panel under a window is metal or a darker
       * stone, not the same limestone as the structure. Half a percent of
       * separation is enough to read as a band and nowhere near enough to
       * introduce colour.
       */
      float spandrel = (1.0 - smoothstep(sill - aaY, sill, storeyF)) *
                       smoothstep(0.0, aaY, storeyF) * resolve;

      vec3 stone = uStoneColor;
      stone = mix(stone, uStoneColor * 0.93, spandrel * (1.0 - glass));
      stone *= mix(1.0, 1.05, pier * resolve);
      stone *= mix(1.0, 0.88, slab * resolve * (1.0 - glass));
      stone = mix(stone, stone * 0.72, divider);

      // Darker where the street shades it, brighter facing open sky.
      float streetShade = mix(0.90, 1.05, clamp(vUp / max(vWall, 1.0), 0.0, 1.0));
      albedo = stone * streetShade;

      /**
       * Interior mapping: a room behind the glass, with zero geometry.
       *
       * The technique is a parallax raycast. Each window is treated as the
       * front face of a box the depth of an office bay. The view ray is
       * marched from the pane into that box in the wall's own tangent space,
       * and whichever of the five interior faces it hits decides what is
       * drawn. The room shifts correctly as you walk past — the back wall
       * moves slowly, the side walls sweep — which is the entire cue that
       * says "space" rather than "picture".
       *
       * It is the highest-payoff item in the plan and it is what makes glass
       * worth having: a mirror is a surface, a room is a place.
       *
       * Cost is a handful of instructions on fragments that are being
       * rasterised anyway. No geometry, no texture, no draw call.
       *
       * Two things it is deliberately NOT:
       *
       * - It is not a real interior. It is a lit box with a floor, a ceiling
       *   and a back wall, and a slab across it at desk height. Nobody should
       *   read a floor plan off it, and the plan lists modelling interiors
       *   per space by hand as a non-goal.
       * - It is not on in daylight. A warm speckle across every glass tower
       *   at noon is invisible as an effect and visible as noise, and
       *   Goldenrod is meant to be the only warm thing in the frame.
       */
      if (uInterior > 0.001 && glass > 0.001) {
        vec2 cell = floor(vec2(bay, storey));
        float occupied = step(0.42, hash21(cell));

        if (occupied > 0.5) {
          // Where in the pane, 0-1 on each axis.
          vec2 uv = vec2(
            clamp((bayF - mullion) / max(1.0 - 2.0 * mullion, 1e-3), 0.0, 1.0),
            clamp((storeyF - sill) / max(head - sill, 1e-3), 0.0, 1.0)
          );

          // The view direction in the wall's tangent frame: right along the
          // wall, up the wall, and out of it.
          vec3 T = normalize(vec3(-N.y, N.x, 0.0));
          vec3 B = vec3(0.0, 0.0, 1.0);
          vec3 ray = normalize(vec3(dot(-V, T), dot(-V, B), dot(-V, N)));

          // Room depth as a fraction of the pane's width, so a wide bay gets
          // a proportionally deep room and the box never reads as a slot.
          float depth = 1.35;

          // March to the back wall, then see whether a side, floor or
          // ceiling is hit first. Slab method: the smallest positive
          // intersection wins.
          float tz = ray.z < -1e-4 ? depth / -ray.z : 1e6;
          float tx = abs(ray.x) > 1e-4
            ? ((ray.x > 0.0 ? 1.0 - uv.x : uv.x) / abs(ray.x)) : 1e6;
          float ty = abs(ray.y) > 1e-4
            ? ((ray.y > 0.0 ? 1.0 - uv.y : uv.y) / abs(ray.y)) : 1e6;
          float t = min(tz, min(tx, ty));

          vec3 hit = vec3(uv, 0.0) + ray * t;

          // A different shade per face is what makes the box read as a room
          // rather than as a flat tint: the back wall is lit, the sides fall
          // away, the ceiling is bright and the floor is dark.
          float face = t == tz ? 1.0 : (t == ty ? (ray.y > 0.0 ? 1.25 : 0.45) : 0.62);

          // The lit ceiling plane, which is what an office at night actually
          // is: a bright band across the top of every window.
          float ceilingGlow = smoothstep(0.55, 1.0, hit.y) * 0.9;
          // And the desk line: a horizontal slab a third of the way up, the
          // one piece of furniture that reads at this scale.
          float desks = (1.0 - smoothstep(0.24, 0.34, abs(hit.y - 0.29))) * 0.45;

          vec3 room = vec3(1.0, 0.90, 0.74) * (0.30 + ceilingGlow + desks) * face;
          // Deeper into the room is dimmer, which is the depth cue that
          // survives being three pixels tall.
          room *= mix(1.0, 0.45, clamp(hit.z / depth, 0.0, 1.0));

          roomLight = room * uInterior * glass;
        }
      }
    }

    // --- Light. One sun, one sky, and a wrap term standing in for the sky
    // filling in the shaded side. No shadow map: at city scale it is where
    // deck.gl's own shadow pass produced the acne that striped every facade,
    // and this mode cannot afford that on glass.
    vec3 L = normalize(-uSunDir);
    float ndl = max(dot(N, L), 0.0);
    float wrapped = max((dot(N, L) + 0.35) / 1.35, 0.0);

    vec3 skyUp = skyColor(vec3(0.0, 0.0, 1.0));
    vec3 ambient = mix(skyUp, uHorizonColor, 0.45) * uAmbient * 0.62;
    vec3 direct = uSunColor * uSunIntensity * mix(ndl, wrapped, 0.5) * 0.55;

    vec3 color = albedo * (ambient + direct);

    if (glass > 0.001) {
      vec3 R = reflect(-V, N);
      vec3 reflected = skyColor(R);
      float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
      // Coated architectural glazing is near a third face-on, which is why a
      // glass tower is a building-shaped piece of sky rather than a dark box.
      float reflectance = max(fresnel, 0.34);
      vec3 pane = mix(uGlassColor * (ambient + direct * 0.5), reflected, reflectance);

      // A tight specular lobe. A broad one washes the whole flank to white,
      // which is the exact failure the luminance clamp exists for.
      vec3 H = normalize(L + V);
      pane += uSunColor * pow(max(dot(N, H), 0.0), 220.0) * 0.55 * uSunIntensity;
      pane += roomLight;

      color = mix(color, pane, glass);
    }

    color = holdBelowBand(color, ${MAX_FACADE_LUMA.toFixed(3)});
    color = applyHaze(color, dist);

    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface FacadeOptions {
  floorHeightM: number;
  bayWidthM?: number;
  glassFraction?: number;
  /** Selects the stone. Null falls to the midcentury value. */
  yearBuilt?: number | null;
  /** Decorrelates the lit-window pattern between neighbouring towers. */
  seed?: number;
  /** 0-1. How lit the interiors are. Raised at dusk and night. */
  interior?: number;
  /** Massing only — no fenestration. Used for context buildings. */
  plain?: boolean;
}

/**
 * Stone, per era, all of it near-white.
 *
 * The spread is deliberately tiny — four values inside six percent of each
 * other. It is enough that a limestone tower and a glass one are not the same
 * grey, and nowhere near enough for any of them to read as coloured. The
 * moment this palette gets interesting, the map has lost its hierarchy.
 */
export function stoneFor(yearBuilt: number | null): THREE.Color {
  const year = yearBuilt ?? 1965;
  // Limestone, cast stone, precast, and the pale grey of a modern curtain
  // wall's opaque spandrel. Four values inside six percent of each other.
  if (year < 1930) return new THREE.Color(0.955, 0.936, 0.900);
  if (year < 1960) return new THREE.Color(0.944, 0.932, 0.910);
  if (year < 1990) return new THREE.Color(0.922, 0.922, 0.922);
  return new THREE.Color(0.930, 0.938, 0.946);
}

export function makeFacadeMaterial(
  preset: AtmospherePreset,
  sunDir: [number, number, number],
  options: FacadeOptions,
): THREE.ShaderMaterial {
  const uniforms: Record<string, { value: unknown }> = {
    uSunDir: { value: new THREE.Vector3(...sunDir) },
    uSunColor: { value: rgb(preset.sunColor) },
    uSunIntensity: { value: preset.sun },
    uAmbient: { value: preset.ambient },
    uSkyColor: { value: new THREE.Color(preset.sky) },
    uHorizonColor: { value: new THREE.Color(preset.horizon) },
    uHazeColor: { value: rgb(preset.haze) },
    uHazeStrength: { value: preset.hazeStrength },
    uFloorHeight: { value: options.floorHeightM },
    uBayWidth: { value: options.bayWidthM ?? 2.2 },
    // Zero glass fraction turns the pane test off entirely, which is what
    // makes the same shader serve the context city at no extra cost.
    uGlassFraction: { value: options.plain ? 0 : options.glassFraction ?? 0.56 },
    uStoneColor: { value: stoneFor(options.yearBuilt ?? null) },
    uGlassColor: { value: new THREE.Color(0.74, 0.79, 0.83) },
    uCameraPos: { value: new THREE.Vector3() },
    uInterior: { value: 0 },
    uTime: { value: 0 },
    // Per-building, so two towers side by side do not light the same windows.
    uSeed: { value: options.seed ?? 0 },
  };

  return new THREE.ShaderMaterial({
    uniforms: uniforms as THREE.ShaderMaterial['uniforms'],
    vertexShader: FACADE_VERTEX,
    fragmentShader: FACADE_FRAGMENT,
    // Buildings are closed shells, so the inside of a wall is never wanted —
    // except that a camera walking INTO a lobby would see through the wall it
    // just passed. Sprint 7 handles that case; until then, cull.
    side: THREE.FrontSide,
  });
}

/** deck.gl's 0-255 triples, as a three.js colour. */
function rgb(c: readonly [number, number, number]): THREE.Color {
  return new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
}

/**
 * Keeps a material's per-frame uniforms current.
 *
 * Camera position drives both the reflection and the haze, so this has to run
 * every frame the camera moves — which, in a mode whose whole point is moving
 * the camera, is every frame.
 */
export function updateFacadeUniforms(
  material: THREE.ShaderMaterial,
  cameraPos: THREE.Vector3,
  timeSeconds: number,
): void {
  (material.uniforms.uCameraPos.value as THREE.Vector3).copy(cameraPos);
  material.uniforms.uTime.value = timeSeconds;
}

/** Re-points an existing material at a different hour, without recompiling. */
export function applyPreset(
  material: THREE.ShaderMaterial,
  preset: AtmospherePreset,
  sunDir: [number, number, number],
): void {
  // Lit windows belong to the dark hours. At midday they are invisible
  // anyway, and drawing them costs a branch on every glass fragment in the
  // city — and, worse, adds warm speckle to a frame whose whole point is that
  // Goldenrod is the only warm thing in it.
  material.uniforms.uInterior.value = interiorFor(preset);
  (material.uniforms.uSunDir.value as THREE.Vector3).set(...sunDir);
  (material.uniforms.uSunColor.value as THREE.Color).copy(rgb(preset.sunColor));
  material.uniforms.uSunIntensity.value = preset.sun;
  material.uniforms.uAmbient.value = preset.ambient;
  (material.uniforms.uSkyColor.value as THREE.Color).set(preset.sky);
  (material.uniforms.uHorizonColor.value as THREE.Color).set(preset.horizon);
  (material.uniforms.uHazeColor.value as THREE.Color).copy(rgb(preset.haze));
  material.uniforms.uHazeStrength.value = preset.hazeStrength;
}

/**
 * How lit the interiors are, at a given hour.
 *
 * Night is not full: an office tower at 3am has a scattering of lights, not a
 * grid of them, and the `hash21` threshold in the shader already thins them.
 * This scales what is left.
 *
 * Midday is exactly zero rather than nearly zero. A warm speckle across every
 * glass tower in daylight is invisible as an effect and visible as noise, and
 * noise is the thing this frame has the least room for.
 */
export function interiorFor(preset: AtmospherePreset): number {
  switch (preset.key) {
    case 'night':
      return 0.85;
    case 'golden':
      return 0.35;
    default:
      return 0;
  }
}

/**
 * The facade, seen from inside the building.
 *
 * Space exploration only works if you can see out, and the facade material
 * cannot do that: it is a curtain wall painted from the street, and turning
 * it double-sided just puts the same opaque wall between you and the view.
 * From a tenant's side a curtain wall is nearly all glass — the thing you
 * actually see is the grid of mullions and transoms holding it up, and the
 * city through the panes.
 *
 * So while you are inside, the containing building's mesh is drawn with this
 * instead: back faces only, mullions at the same bay and storey rhythm the
 * outside uses, and panes at six percent so the sky and the towers opposite
 * come through with only a hint of tint. It is swapped back on the way out.
 *
 * `depthWrite` is off because it is transparent and the city behind it must
 * not be culled by it. It draws late, after the opaque scene, which is what
 * `renderOrder` on the host mesh arranges.
 */
export function makeInteriorGlassMaterial(
  preset: AtmospherePreset,
  floorHeightM: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uFloorHeight: { value: Math.max(2.4, floorHeightM) },
      uBayWidth: { value: 2.2 },
      uFrameColor: { value: new THREE.Color(0.62, 0.63, 0.65) },
      uGlassTint: { value: new THREE.Color(preset.sky) },
    },
    vertexShader: [
      'attribute float along;',
      'attribute float up;',
      'varying float vAlong;',
      'varying float vUp;',
      'void main() {',
      '  vAlong = along;',
      '  vUp = up;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'uniform float uFloorHeight;',
      'uniform float uBayWidth;',
      'uniform vec3 uFrameColor;',
      'uniform vec3 uGlassTint;',
      'varying float vAlong;',
      'varying float vUp;',
      '',
      '// Distance to the nearest gridline, in metres, for a given spacing.',
      'float lineDist(float v, float spacing) {',
      '  float f = fract(v / spacing);',
      '  return min(f, 1.0 - f) * spacing;',
      '}',
      '',
      'void main() {',
      '  float mull = lineDist(vAlong, uBayWidth);',
      '  float tran = lineDist(vUp, uFloorHeight);',
      '  // 60 mm of frame, softened over another 30 so it does not crawl.',
      '  float frame = 1.0 - smoothstep(0.06, 0.09, min(mull, tran));',
      '  vec3 color = mix(uGlassTint, uFrameColor, frame);',
      '  gl_FragColor = vec4(color, mix(0.06, 0.92, frame));',
      '}',
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    // Only the inner surface. The outer one is somebody else's view.
    side: THREE.BackSide,
  });
}
