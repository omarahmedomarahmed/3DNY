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
  uniform vec3 uHorizonColor;
  uniform float uHazeStrength;
  uniform vec3 uCameraPos;
  varying vec3 vWorld;

  void main() {
    float dist = length(uCameraPos - vWorld);
    // The ground runs to the horizon, so it needs a much longer haze ramp than
    // a building does or it turns into a hard-edged disc of pavement sitting
    // in mid-air. Buildings fade between 700 m and 6.2 km; this keeps going.
    /**
     * Fade all the way to the horizon colour, well before the plane ends.
     *
     * The first version faded to 9 km on a 12 km plane, so the last three
     * kilometres were flat grey and the plane's own edge showed as a hard
     * straight line across the frame with sky above it. From a pitched camera
     * that reads as the world running out.
     *
     * Now the plane is 120 km and the fade completes at 14 km — an order of
     * magnitude inside it — so the edge is far past the point where the
     * ground and the sky are the same colour and there is nothing to see.
     */
    float t = smoothstep(300.0, 14000.0, dist);
    vec3 color = mix(uGroundColor, uHorizonColor, t);
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
      uHorizonColor: { value: new THREE.Color(preset.horizon) },
      uHazeStrength: { value: preset.hazeStrength },
      uCameraPos: { value: new THREE.Vector3() },
    },
    vertexShader: GROUND_VERTEX,
    fragmentShader: GROUND_FRAGMENT,
    side: THREE.DoubleSide,
    /**
     * The ground plane writes colour and nothing else.
     *
     * It is a backdrop 120 km across sunk five centimetres below the streets,
     * and while it wrote depth it was winning the depth test against them from
     * any distance: at a pitched camera looking a kilometre down an avenue the
     * far plane is tens of kilometres away, so five centimetres is well inside
     * one step of the depth buffer and the roadbed, the kerbs and the lane
     * lines all vanished into it. That is why the streets were not there —
     * they were being built, uploaded and drawn every frame, and losing.
     *
     * Nothing needs the plane in the depth buffer. Everything else in the
     * scene is above it, so it can never legitimately occlude anything, and
     * drawn first at `renderOrder -10` it still sits behind them all.
     */
    depthWrite: false,
  });

  // 120 km, so the plane's own edge is far past the distance at which it has
  // already become the horizon.
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(120_000, 120_000), material);
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
