import * as THREE from 'three';
import type { AtmospherePreset } from '../map/atmosphere';

/**
 * The sky, the sun, and the clouds — ours, not MapLibre's.
 *
 * MapLibre draws a sky and Explore mode has been relying on it, which was a
 * mistake for three reasons. It sits behind everything three.js draws, so the
 * 12 km ground plane hides most of it. It has no sun in it — only a gradient
 * the sun's position tints. And it stops existing the moment a basemap style
 * fails to load, which is a normal state in a corporate network and the exact
 * state a demo is most likely to be given.
 *
 * So the sky is a dome inside the scene: drawn first, depth-write off, with a
 * real sun disc at the real solar position for the hour, and cloud cover that
 * moves.
 *
 * **It is still almost colourless.** A dramatic sky is the easiest thing in
 * the world to add and the fastest way to lose the one rule — clouds lit
 * orange at golden hour are large, saturated, and moving, which beats a
 * Goldenrod band on every axis at once. These clouds are white to pale grey
 * and the sun is a small warm disc. The sky is the thing you stop noticing
 * after two seconds, which is what a sky is for.
 */

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Clouds by value noise, not by texture.
 *
 * Two octaves of hashed lattice noise, scrolled by the clock. It costs a
 * couple of dozen instructions on a dome that covers a fraction of the frame,
 * against a cloud texture that would be a download, a load-order problem and a
 * decision about which sky to ship.
 */
const SKY_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform vec3 uSkyColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunSize;
  uniform float uCloudAmount;
  uniform float uCloudLight;
  uniform float uTime;

  varying vec3 vDir;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    // Smoothstep interpolation, so the lattice does not show as a grid.
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  void main() {
    vec3 dir = normalize(vDir);
    float up = clamp(dir.z, -1.0, 1.0);

    // --- The gradient. Horizon colour at eye level, sky colour overhead, and
    // the transition compressed toward the horizon the way real haze is.
    float t = pow(clamp(up, 0.0, 1.0), 0.55);
    vec3 color = mix(uHorizonColor, uSkyColor, t);

    // Below the horizon the dome continues, in the horizon's own colour, so
    // that a camera tipped past level sees air rather than a hard edge.
    color = mix(uHorizonColor, color, smoothstep(-0.06, 0.04, up));

    // --- The sun. A disc with a bloom around it, at the real solar position.
    // uSunDir points the way light TRAVELS, so the sun is the other way.
    vec3 toSun = normalize(-uSunDir);
    float cosAngle = dot(dir, toSun);
    float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.35, cosAngle);
    float bloom = pow(max(cosAngle, 0.0), 220.0) * 0.55
                + pow(max(cosAngle, 0.0), 12.0) * 0.10;
    // Only above the horizon: a sun drawn through the pavement is a bug that
    // reads as a lens flare and confuses everybody.
    float sunUp = smoothstep(-0.02, 0.06, toSun.z);
    color += uSunColor * (disc * 0.9 + bloom) * sunUp;

    // --- Clouds. Flattened onto a plane above the camera, so they converge at
    // the horizon the way a real overcast does rather than wrapping the dome
    // like a marble.
    if (uCloudAmount > 0.001 && up > 0.02) {
      vec2 plane = dir.xy / max(up, 0.06);
      vec2 drift = vec2(uTime * 0.020, uTime * 0.009);
      /**
       * The base frequency is five cells per unit of the projected plane, not
       * one.
       *
       * At the first value a camera pointed near the zenith was looking at less
       * than a single lattice cell of the noise, magnified across the whole
       * frame — so straight up was a flat wash with no cloud in it at all,
       * while the horizon, where the projection stretches, looked fine. The
       * frequency has to be high enough that overhead sees structure; the
       * horizon then compresses it, which is what a real overcast does.
       */
      float n = noise(plane * 5.0 + drift) * 0.62
              + noise(plane * 12.0 - drift * 1.7) * 0.28
              + noise(plane * 26.0 + drift * 2.4) * 0.10;

      // Coverage carves cloud out of the noise; the smoothstep width is what
      // makes an edge soft rather than a shoreline.
      float cover = smoothstep(0.62 - uCloudAmount * 0.45, 0.92 - uCloudAmount * 0.30, n);

      /**
       * The rim, which is where a projected cloud plane goes wrong.
       *
       * The quantity dir.xy/up grows without bound as the view approaches level, so a
       * few degrees above the horizon one noise cell is stretched across
       * hundreds of pixels and the cloud layer smears into radial streaks —
       * the sky visibly pulling apart at the edge of the world. It is only
       * obvious once you can look along the horizon, which is exactly what the
       * free camera made possible.
       *
       * Two things fix it and both are honest about the geometry rather than
       * hiding it. The distance out along the plane is faded to nothing before
       * the stretch becomes visible, and the smoothstep is wide, so the layer
       * thins into haze the way a real overcast does at its own horizon
       * instead of ending at a line.
       */
      float reach = length(plane);
      cover *= 1.0 - smoothstep(6.0, 17.0, reach);

      /**
       * Clouds still run close to the horizon, because real ones do.
       *
       * An earlier version faded them out below 34° of elevation, which sounds
       * harmless and means that from any camera looking at a skyline — which
       * is every camera anyone points at this — there are no clouds in the
       * frame at all.
       */
      cover *= smoothstep(0.010, 0.075, up);

      vec3 cloud = vec3(uCloudLight);
      // A hint of the sun's warmth on the side facing it, and no more than a
      // hint: a sky full of orange cloud out-shouts every band on screen.
      cloud = mix(cloud, uSunColor * uCloudLight, clamp(cosAngle, 0.0, 1.0) * 0.22 * sunUp);
      color = mix(color, cloud, cover * 0.85);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface SkyHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  dispose(): void;
}

/**
 * How much cloud each hour gets.
 *
 * Not a weather model and not meant to be — weather is a stated non-goal. It
 * is a small, fixed amount so the sky is not an empty gradient, and it is
 * lowest at night, when cloud is a grey smear that only dulls the city.
 */
function cloudFor(preset: AtmospherePreset): { amount: number; light: number } {
  switch (preset.key) {
    case 'morning':
      return { amount: 0.42, light: 0.97 };
    case 'midday':
      return { amount: 0.34, light: 1.0 };
    case 'golden':
      return { amount: 0.5, light: 0.9 };
    case 'night':
    default:
      return { amount: 0.22, light: 0.26 };
  }
}

export function makeSky(
  preset: AtmospherePreset,
  sunDir: [number, number, number],
): SkyHandle {
  const cloud = cloudFor(preset);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSkyColor: { value: new THREE.Color(preset.sky) },
      uHorizonColor: { value: new THREE.Color(preset.horizon) },
      uSunColor: {
        value: new THREE.Color(
          preset.sunColor[0] / 255,
          preset.sunColor[1] / 255,
          preset.sunColor[2] / 255,
        ),
      },
      uSunDir: { value: new THREE.Vector3(...sunDir) },
      /**
       * Larger than life, on purpose.
       *
       * The sun is half a degree across, which at this field of view is about
       * three pixels — a dot nobody registers as the sun. Every architectural
       * render and every game enlarges it for the same reason. This is about
       * four degrees, which reads as the sun and is still small enough that it
       * cannot compete with a Goldenrod band for attention.
       */
      uSunSize: { value: 0.0026 },
      uCloudAmount: { value: cloud.amount },
      uCloudLight: { value: cloud.light },
      uTime: { value: 0 },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    // Seen from the inside.
    side: THREE.BackSide,
    // The dome must never occlude anything, and must never be occluded by
    // distance: it is not in the world, it IS the distance.
    depthWrite: false,
    depthTest: false,
  });

  // 40 km, which is past the ground plane and past anything the haze leaves
  // visible. It is drawn without depth testing, so the radius only has to be
  // large enough that the camera is comfortably inside it.
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(40_000, 32, 20), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;

  return {
    mesh,
    material,
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

/** Re-points an existing sky at a different hour, without recompiling. */
export function applySkyPreset(
  handle: SkyHandle,
  preset: AtmospherePreset,
  sunDir: [number, number, number],
): void {
  const u = handle.material.uniforms;
  (u.uSkyColor.value as THREE.Color).set(preset.sky);
  (u.uHorizonColor.value as THREE.Color).set(preset.horizon);
  (u.uSunColor.value as THREE.Color).setRGB(
    preset.sunColor[0] / 255,
    preset.sunColor[1] / 255,
    preset.sunColor[2] / 255,
  );
  (u.uSunDir.value as THREE.Vector3).set(...sunDir);
  const cloud = cloudFor(preset);
  u.uCloudAmount.value = cloud.amount;
  u.uCloudLight.value = cloud.light;
}

/**
 * Keeps the dome centred on the camera.
 *
 * A sky you can travel toward is a dome; a sky you cannot is the sky. Moving
 * it with the eye every frame is what makes 40 km of sphere behave like
 * infinity.
 */
export function updateSky(
  handle: SkyHandle,
  cameraPos: THREE.Vector3,
  seconds: number,
): void {
  handle.mesh.position.copy(cameraPos);
  handle.mesh.updateMatrixWorld();
  handle.material.uniforms.uTime.value = seconds;
}
