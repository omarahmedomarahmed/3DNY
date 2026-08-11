import * as THREE from 'three';
import type { AtmospherePreset } from '../map/atmosphere';

/**
 * The ground Explore mode stands on.
 *
 * The flat map draws its streets, kerbs and parks with deck.gl, and in Explore
 * mode it cannot: deck.gl's overlay is a separate canvas composited on top of
 * MapLibre's, so an opaque road drawn there paints over the tower standing on
 * it. Every square metre of world that buildings can be in front of has to be
 * drawn in the same buffer as the buildings.
 *
 * This is the first half of that — a pale roadbed plane with a gentle
 * horizon-ward falloff, so the city has something to sit on and a ground
 * shadow has something to land on. Real centrelines, kerbs and pavements come
 * from `useStreetscape` and land on top of this.
 *
 * It is 12 km across, which is well past anything the haze leaves visible, and
 * it is two triangles.
 */

const GROUND_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GROUND_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uGroundColor;
  uniform vec3 uHazeColor;
  uniform float uHazeStrength;
  uniform vec3 uCameraPos;
  varying vec3 vWorld;

  void main() {
    float dist = length(uCameraPos - vWorld);
    // The ground runs to the horizon, so it needs a much longer haze ramp than
    // a building does or it turns into a hard-edged disc of pavement sitting
    // in mid-air. Buildings fade between 700 m and 6.2 km; this keeps going.
    float t = smoothstep(400.0, 9000.0, dist);
    vec3 color = mix(uGroundColor, uHazeColor, t * clamp(uHazeStrength + 0.15, 0.0, 1.0));
    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface GroundHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

/**
 * Pale, neutral, no grime — and lit by the hour, not by the theme.
 *
 * The first version keyed off the light/dark theme, and at night that left a
 * near-white pavement under a black sky with a dark city standing on it. It
 * read as a mistake rather than as a choice, because it is one: the ground is
 * lit by the same sun as everything above it.
 *
 * So it is derived from the hour's own haze colour, darkened. That also keeps
 * the ground and the horizon in agreement automatically, which is what stops
 * the plane's far edge showing up as a line across the frame.
 */
export function groundColor(preset: AtmospherePreset): THREE.Color {
  const c = new THREE.Color(
    preset.haze[0] / 255,
    preset.haze[1] / 255,
    preset.haze[2] / 255,
  );
  // A roadbed is darker than the air above it at every hour. 0.78 keeps the
  // kerb-to-sky separation without turning the daytime street grey.
  return c.multiplyScalar(0.78);
}

export function makeGround(preset: AtmospherePreset): GroundHandle {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uGroundColor: { value: groundColor(preset) },
      uHazeColor: {
        value: new THREE.Color(
          preset.haze[0] / 255,
          preset.haze[1] / 255,
          preset.haze[2] / 255,
        ),
      },
      uHazeStrength: { value: preset.hazeStrength },
      uCameraPos: { value: new THREE.Vector3() },
    },
    vertexShader: GROUND_VERTEX,
    fragmentShader: GROUND_FRAGMENT,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(12_000, 12_000), material);
  // The plane is born in XY facing +Z, which is already correct for a scene
  // whose up axis is Z. A rotation here is the classic way to end up with a
  // ground plane standing on edge.
  //
  // Sunk a few centimetres so a road, a pavement or a contact shadow drawn at
  // exactly zero has somewhere to be without z-fighting against it.
  mesh.position.set(0, 0, -0.05);
  mesh.frustumCulled = false;
  // Drawn before everything, so a building always wins the depth test at its
  // own base rather than fighting the pavement for the same pixel.
  mesh.renderOrder = -10;

  return { mesh, material };
}
