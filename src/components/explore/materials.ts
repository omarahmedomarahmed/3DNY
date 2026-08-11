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

  varying vec3 vNormal;
  varying vec3 vWorld;
  varying float vAlong;
  varying float vUp;
  varying float vWall;
  varying float vIsWall;

  ${SKY_GLSL}
  ${HAZE_GLSL}

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCameraPos - vWorld);
    float dist = length(uCameraPos - vWorld);

    vec3 albedo = uStoneColor;
    float glass = 0.0;
    float roughness = 1.0;

    if (vIsWall > 0.5) {
      // --- Where in the bay and where in the storey.
      float bay = vAlong / uBayWidth;
      float storey = vUp / uFloorHeight;
      float bayF = fract(bay);
      float storeyF = fract(storey);

      // Fade the whole grid out once a bay is close to a pixel wide. Below
      // that it is aliasing, and aliasing is loud.
      float bayPx = fwidth(bay);
      float storeyPx = fwidth(storey);
      float resolve = 1.0 - smoothstep(0.30, 0.70, max(bayPx, storeyPx));

      // --- The pane: inset from the bay edges and sitting above a spandrel.
      float mullion = 0.14;
      float sill = 1.0 - uGlassFraction;
      float paneX = smoothstep(mullion, mullion + max(bayPx * 1.6, 0.02), bayF) *
                    (1.0 - smoothstep(1.0 - mullion - max(bayPx * 1.6, 0.02), 1.0 - mullion, bayF));
      float paneY = smoothstep(sill, sill + max(storeyPx * 1.6, 0.02), storeyF) *
                    (1.0 - smoothstep(0.94 - max(storeyPx * 1.6, 0.02), 0.94, storeyF));
      glass = paneX * paneY * resolve;

      // --- Piers. A heavier vertical every fifth bay, which is what stops the
      // grid reading as hatching and starts it reading as structure.
      float pier = 1.0 - smoothstep(0.0, max(fwidth(bay / 5.0) * 1.6, 0.03),
                                    min(fract(bay / 5.0), 1.0 - fract(bay / 5.0)));
      // --- The floor line: the slab edge between one storey and the next.
      float slab = 1.0 - smoothstep(0.0, max(storeyPx * 1.4, 0.02),
                                    min(storeyF, 1.0 - storeyF));

      // Stone, shaded by its own relief. Piers stand proud and catch light;
      // the slab edge sits back and reads as a shadow line.
      vec3 stone = uStoneColor;
      stone *= mix(1.0, 1.06, pier * resolve);
      stone *= mix(1.0, 0.90, slab * resolve * (1.0 - glass));

      // A wall is darker at the bottom, where the street shades it, and
      // brighter where it faces open sky. The cheapest cue that a tower is
      // standing in a city rather than floating in one.
      float streetShade = mix(0.90, 1.05, clamp(vUp / max(vWall, 1.0), 0.0, 1.0));
      albedo = stone * streetShade;
      roughness = mix(1.0, 0.08, glass);
    }

    // --- Light. One sun, one sky, and a ground bounce. No shadow map: at city
    // scale it is where deck.gl's own shadow pass produced the acne that made
    // every facade look striped, and this mode cannot afford that on glass.
    vec3 L = normalize(-uSunDir);
    float ndl = max(dot(N, L), 0.0);
    // A shallow wrap, standing in for the sky filling in the shaded side.
    float wrapped = max((dot(N, L) + 0.35) / 1.35, 0.0);

    /**
     * Exposure, chosen so a sunlit limestone wall lands near 0.82 and a wall
     * in its own shade near 0.58.
     *
     * That spread is the art direction: VU.CITY's city is near-white and matte
     * with genuine modelling on it, not a grey city with a light on it. The
     * numbers are what they are because the output is display-referred — see
     * MAX_FACADE_LUMA. Halve them and the city goes to slate; double them and
     * every wall clips and the bands lose.
     */
    vec3 skyUp = skyColor(vec3(0.0, 0.0, 1.0));
    vec3 ambient = mix(skyUp, uHorizonColor, 0.45) * uAmbient * 0.62;
    vec3 direct = uSunColor * uSunIntensity * mix(ndl, wrapped, 0.5) * 0.55;

    vec3 color = albedo * (ambient + direct);

    if (glass > 0.001) {
      // --- Glass. The only shiny thing in the world.
      vec3 R = reflect(-V, N);
      vec3 reflected = skyColor(R);
      // Schlick, with a low base reflectance: architectural glazing is around
      // 4% face-on and near a mirror at grazing angles, which is exactly the
      // behaviour that makes a tower's flank light up as you walk past it.
      float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);

      /**
       * A tower's glass reads PALE, not dark.
       *
       * The first version used a textbook 4% face-on reflectance and a dark
       * tinted pane, and the result was a slate-blue building — because a
       * curtain wall is mostly glass, so whatever the glass does the building
       * does. Real architectural glazing is coated: reflectance face-on is
       * nearer a third, which is why a glass tower on a clear day is a
       * building-shaped piece of sky rather than a dark box.
       *
       * That also matters for the one rule. A dark city and a Goldenrod band
       * is a high-contrast pairing that looks striking and is the OPPOSITE of
       * the art direction: on a dark city every lit window competes. Pale
       * glass, near-white stone, one saturated colour.
       */
      float reflectance = max(fresnel, 0.34);
      vec3 pane = mix(uGlassColor * (ambient + direct * 0.5), reflected, reflectance);

      // The specular lobe. Tight, because a broad one washes the whole flank
      // to white and that is the exact failure the luminance clamp exists for.
      vec3 H = normalize(L + V);
      float spec = pow(max(dot(N, H), 0.0), 220.0) * 0.55;
      pane += uSunColor * spec * uSunIntensity;

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
  (material.uniforms.uSunDir.value as THREE.Vector3).set(...sunDir);
  (material.uniforms.uSunColor.value as THREE.Color).copy(rgb(preset.sunColor));
  material.uniforms.uSunIntensity.value = preset.sun;
  material.uniforms.uAmbient.value = preset.ambient;
  (material.uniforms.uSkyColor.value as THREE.Color).set(preset.sky);
  (material.uniforms.uHorizonColor.value as THREE.Color).set(preset.horizon);
  (material.uniforms.uHazeColor.value as THREE.Color).copy(rgb(preset.haze));
  material.uniforms.uHazeStrength.value = preset.hazeStrength;
}
