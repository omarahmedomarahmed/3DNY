import * as THREE from 'three';
import type { StreetscapeResult, WaterPolygon } from '@/lib/streetscape';
import type { AtmospherePreset } from '../map/atmosphere';
import { ringToLocal, type LocalFrame } from '@/lib/explore/frame';
import { triangulate } from '@/lib/explore/tessellate';

/**
 * The rivers.
 *
 * Manhattan is an island, and a model of it with no water in it reads as a
 * street plan rather than as a place — the East River and the Hudson are the
 * two edges that tell you where you are before any label does.
 *
 * The flat map draws them with deck.gl, which Explore cannot use: an opaque
 * water polygon on deck.gl's own canvas paints over the towers standing in
 * front of it.
 *
 * The surface is a shader rather than a flat fill, because water is the one
 * thing in this scene that genuinely is not matte, and a flat blue-grey
 * polygon reads as a hole in the map. Three things make it read as water and
 * none of them cost a texture:
 *
 * | | |
 * |---|---|
 * | Sky reflection | Fresnel against the same analytic sky the glass uses, so the river is the colour of the hour |
 * | Sun glitter | A specular lobe broken up by moving ripples, which is what a river actually looks like from above |
 * | Depth colour | Darker looking straight down, paler at grazing angles |
 *
 * It stays as desaturated as everything else here. A bright blue river is a
 * large saturated shape in the frame, and there is only room for one of those.
 */

const WATER_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform vec3 uSkyColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uWaterColor;
  uniform vec3 uCameraPos;
  uniform float uTime;
  uniform float uSunStrength;
  /* 1 for the water you are standing beside, 0 for the far harbour. */
  uniform float uDetail;

  varying vec3 vWorld;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  vec3 skyColor(vec3 dir) {
    float t = pow(clamp(dir.z, 0.0, 1.0), 0.55);
    return mix(uHorizonColor, uSkyColor, t);
  }

  void main() {
    vec3 V = normalize(uCameraPos - vWorld);

    /**
     * Ripples as a perturbed normal, not as displaced geometry.
     *
     * Two noise fields drifting against each other at different scales and
     * speeds. Displacing the surface would need a subdivided mesh over several
     * square kilometres of river for an effect that is only ever visible in
     * how the light moves.
     */
    /**
     * The far harbour skips the ripples and the glitter entirely.
     *
     * Six noise lookups and a 90-power specular per fragment is the right cost
     * for the river forty metres away, where you can see individual ripples
     * moving. It is the wrong cost for the twenty square kilometres of harbour
     * that exists so the island has a horizon: at two kilometres a ripple is
     * far below a pixel, so every one of those instructions produces noise
     * that averages out to the flat colour underneath it.
     *
     * Adding the harbour with the full shader cost about 150 ms a frame under
     * software rendering — enough to fail the catastrophe check — for an
     * effect nobody can resolve. The branch is on a uniform, so it is
     * coherent across the whole draw and free.
     */
    vec3 N = vec3(0.0, 0.0, 1.0);
    float spec = 0.0;

    if (uDetail > 0.5) {
      vec2 p = vWorld.xy * 0.05;
      float n1 = noise(p + vec2(uTime * 0.06, uTime * 0.021));
      float n2 = noise(p * 2.7 - vec2(uTime * 0.032, uTime * 0.05));
      vec2 slope = vec2(n1 - n2, n2 - n1) * 0.09;
      N = normalize(vec3(slope, 1.0));

      // Glitter: a tight lobe on a rippled normal, which breaks the highlight
      // into the moving speckle a river has rather than one mirror blob.
      vec3 L = normalize(-uSunDir);
      vec3 H = normalize(L + V);
      spec = pow(max(dot(N, H), 0.0), 90.0);
    }

    // Face-on you see into the water; at a grazing angle you see the sky in
    // it. That flip is most of what makes a surface read as water, and it is
    // cheap, so the harbour keeps it.
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
    vec3 reflected = skyColor(reflect(-V, N));

    vec3 color = mix(uWaterColor, reflected, clamp(fresnel, 0.0, 0.92));
    color += uSunColor * spec * uSunStrength * 0.5;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface WaterHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  triangles: number;
  dispose(): void;
}

/** Slightly below the roadbed, so a quay reads as land meeting water. */
const WATER_Z = -0.35;

function waterColor(preset: AtmospherePreset): THREE.Color {
  // The hour's own horizon, taken down and slightly cooled. Water is the sky
  // seen through a metre of silt, which is close enough to true here.
  return new THREE.Color(preset.horizon).multiplyScalar(0.42).lerp(
    new THREE.Color(0.10, 0.16, 0.22),
    0.45,
  );
}

export function makeWater(
  frame: LocalFrame,
  streetscape: StreetscapeResult,
  preset: AtmospherePreset,
  sunDir: [number, number, number],
  /** False for the far harbour: no ripples, no glitter. See `uDetail`. */
  detailed = true,
): WaterHandle | null {
  const position: number[] = [];
  const index: number[] = [];

  for (const body of streetscape.water as WaterPolygon[]) {
    // The first ring is the shore; the rest are islands. Holes are dropped
    // rather than cut, because at this scale a dropped island is a few square
    // metres of river where there should be rock, and cutting them properly
    // needs a triangulator with hole support this project does not have.
    const shore = body.rings[0];
    if (!shore || shore.length < 4) continue;

    const local = ringToLocal(frame, shore);
    const tris = triangulate(local);
    if (tris.length === 0) continue;

    const base = position.length / 3;
    for (const [x, y] of local) position.push(x, y, WATER_Z);
    for (const t of tris) index.push(base + t);
  }

  if (index.length === 0) return null;

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
      uSunStrength: { value: preset.sun },
      uWaterColor: { value: waterColor(preset) },
      uCameraPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uDetail: { value: detailed ? 1 : 0 },
    },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    side: THREE.DoubleSide,
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setIndex(index);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Above the ground plane, below the streets.
  mesh.renderOrder = -9;

  return {
    mesh,
    material,
    triangles: index.length / 3,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function applyWaterPreset(
  handle: WaterHandle,
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
  u.uSunStrength.value = preset.sun;
  (u.uWaterColor.value as THREE.Color).copy(waterColor(preset));
}
