import * as THREE from 'three';
import type { AtmospherePreset } from '../map/atmosphere';
import { poseOf, stepAgents, type Agent } from '@/lib/explore/agents';

/**
 * Cars and people, drawn.
 *
 * Two `InstancedMesh`es and two draw calls, whatever the population. The plan
 * budgets 1,000 draw calls for the whole scene and the surveyed city already
 * spends nineteen of them; movement is not allowed to be where that budget
 * goes.
 *
 * **Colour.** Everything here is a neutral grey. A street full of red and blue
 * cars is the single fastest way to lose the one rule — they are small, they
 * move, and moving saturated colour beats static saturated colour every time.
 * On a near-white city a mid-grey car reads perfectly well as a car.
 *
 * **Shape.** Both are built from parts, not from one box.
 *
 * The first version was one box with a smaller box on it, on the argument that
 * a car is never more than a few pixels wide so only the silhouette reads. That
 * argument is wrong about where the camera actually goes. Walk mode puts the
 * eye 1.68 m above the pavement, and from there a car is a metre away and fills
 * a third of the frame — at which point a rectangular block with no wheels does
 * not read as a car, it reads as a crate. The parts that matter are the ones
 * that break the silhouette: wheels, a windscreen rake, a roof narrower than
 * the body; and for a person, a head, limbs, and a gap between the legs.
 *
 * The cost is bounded and small. A car is ~220 triangles and a person ~90, so a
 * fully populated Midtown is around 320,000 triangles against the plan's budget
 * of two million — and it is still two draw calls, because it is still two
 * `InstancedMesh`es.
 */

export interface LifeHandle {
  cars: THREE.InstancedMesh;
  people: THREE.InstancedMesh;
  dispose(): void;
}

/** How many of each the scene will draw. Beyond this they are texture. */
export const MAX_CARS = 900;
export const MAX_PEOPLE = 1400;

/** A part of a body, and how bright it is relative to the whole. */
interface Part {
  geometry: THREE.BufferGeometry;
  /** Multiplied into the material colour through the vertex-colour channel. */
  shade: number;
}

/**
 * Several small geometries into one, with a brightness baked per part.
 *
 * The shade rides in the vertex-colour attribute, which is what lets a car have
 * black tyres, dark glass and a grey body while remaining a single instanced
 * draw call. Doing it with three materials would cost three draw calls per
 * *thousand* cars, which is the entire budget spent on traffic.
 *
 * Merged by hand rather than with `BufferGeometryUtils`, which would pull a
 * second module in for a dozen boxes.
 */
function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let offset = 0;

  for (const part of parts) {
    const p = part.geometry.getAttribute('position');
    const n = part.geometry.getAttribute('normal');
    const index = part.geometry.getIndex();
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      colors.push(part.shade, part.shade, part.shade);
    }
    if (index) for (let i = 0; i < index.count; i++) indices.push(offset + index.getX(i));
    offset += p.count;
    part.geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.setIndex(indices);
  return merged;
}

function box(
  sx: number, sy: number, sz: number,
  x: number, y: number, z: number,
  shade: number,
): Part {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(x, y, z);
  return { geometry: g, shade };
}

/**
 * A saloon, facing +X: 4.5 m long, 1.85 m wide, 1.45 m tall, on four wheels.
 *
 * Five body volumes rather than one, because the shape that says "car" from the
 * pavement is the step from bonnet to windscreen to roof to boot. The greenhouse
 * is inset 0.06 m each side so it reads as glass set into a body rather than as
 * a second block balanced on the first.
 */
function carGeometry(): THREE.BufferGeometry {
  const BODY = 1.0;
  const GLASS = 0.34;
  const TYRE = 0.16;

  const parts: Part[] = [
    // Sills and floor — the full length, low.
    box(4.5, 1.85, 0.42, 0, 0, 0.46, BODY * 0.86),
    // Bonnet, forward and lower than the cabin.
    box(1.45, 1.78, 0.30, 1.45, 0, 0.82, BODY),
    // Boot, shorter and a touch higher than the bonnet, as a saloon's is.
    box(1.05, 1.78, 0.34, -1.65, 0, 0.84, BODY),
    // The greenhouse: glass, inset, spanning the middle.
    box(2.05, 1.66, 0.52, -0.05, 0, 0.99, GLASS),
    // The roof, sitting on the glass and narrower than the body.
    box(1.85, 1.62, 0.10, -0.10, 0, 1.30, BODY),
  ];

  /**
   * Wheels as ten-sided cylinders, which is where the triangles go and where
   * they earn it: a wheel is the one round thing on a street full of boxes, and
   * a square one is visible from much further away than the count suggests.
   *
   * `CylinderGeometry`'s axis is +Y, which is already the axle direction for a
   * car facing +X. No rotation needed, and none that could be got wrong.
   */
  for (const dx of [1.35, -1.35]) {
    for (const dy of [0.86, -0.86]) {
      const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10);
      wheel.translate(dx, dy, 0.34);
      parts.push({ geometry: wheel, shade: TYRE });
    }
  }

  return mergeParts(parts);
}

/**
 * A person: 1.72 m tall, standing on the pavement.
 *
 * A head, a torso, two arms and two legs — seven boxes, 84 triangles. The gap
 * between the legs is the single most important feature: it is what separates a
 * person from a bollard at fifty metres, and neither the head nor the arms do
 * that on their own.
 */
function personGeometry(): THREE.BufferGeometry {
  const SKIN = 0.92;
  const TOP = 1.0;
  const LEGS = 0.72;

  return mergeParts([
    // Head.
    box(0.19, 0.20, 0.23, 0, 0, 1.60, SKIN),
    // Torso, tapering is not worth a second volume at this size.
    box(0.26, 0.42, 0.58, 0, 0, 1.18, TOP),
    // Arms, hanging just clear of the body.
    box(0.13, 0.13, 0.56, 0, 0.27, 1.16, TOP),
    box(0.13, 0.13, 0.56, 0, -0.27, 1.16, TOP),
    // Hips, then two legs with daylight between them.
    box(0.24, 0.36, 0.14, 0, 0, 0.86, LEGS),
    box(0.16, 0.15, 0.80, 0, 0.10, 0.40, LEGS),
    box(0.16, 0.15, 0.80, 0, -0.10, 0.40, LEGS),
  ]);
}

/**
 * Unlit, and shaded by hand against the hour's own horizon colour.
 *
 * The first version used `MeshLambertMaterial` with a hemisphere and a
 * directional light added to the scene, and every car and every person
 * rendered black. This scene's camera has its projection matrix assigned
 * directly and its world matrix left as identity — three.js's lighting is
 * built for a camera it controls, and the combination does not survive that.
 *
 * Rather than debug a light rig that exists for two materials, they are lit
 * the way everything else in this scene is: explicitly, from the atmosphere
 * preset. It also removes the last two `THREE.Light` objects from the scene,
 * so nothing here depends on three.js's lighting at all.
 *
 * Full facade lighting would be worse than either: a car roof catching the sun
 * produces four hundred small bright moving specks in a frame whose whole
 * point is one big static one.
 */
function lifeMaterial(preset: AtmospherePreset, base: number): THREE.MeshBasicMaterial {
  const horizon = new THREE.Color(preset.horizon);
  const grey = new THREE.Color(base, base, base).lerp(horizon, 0.35);
  // `vertexColors` is what carries the per-part shading baked in by
  // `mergeParts` — tyres, glass and paint out of one material.
  return new THREE.MeshBasicMaterial({ color: grey, vertexColors: true });
}

/**
 * A little variation between vehicles, with no colour in it.
 *
 * A street where every car is the same grey reads as a repeated asset, which is
 * exactly what it is. Varying the value — never the hue — breaks that up and
 * cannot cost the hierarchy anything, because a grey at 0.8× and a grey at
 * 1.25× both have zero chroma and a Goldenrod band still has all of it.
 */
function scatterShades(
  mesh: THREE.InstancedMesh,
  total: number,
  spread: number,
  seed: number,
): void {
  const color = new THREE.Color();
  for (let i = 0; i < total; i++) {
    // A hash, not Math.random: the same car is the same grey between frames
    // and between reloads.
    const h = Math.abs(Math.sin((i + seed) * 12.9898) * 43758.5453) % 1;
    const k = 1 - spread + h * spread * 2;
    color.setRGB(k, k, k);
    mesh.setColorAt(i, color);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function makeLife(preset: AtmospherePreset): LifeHandle {
  /**
   * Dark enough to read against a near-white city, and no darker.
   *
   * At 0.52 they were invisible from anywhere above the pavement, which is
   * where this map is usually read from. These are the darkest things in the
   * scene by some way, and that is correct: they are small, so they need
   * value contrast rather than the chroma contrast a band gets.
   */
  const carMaterial = lifeMaterial(preset, 0.30);
  const personMaterial = lifeMaterial(preset, 0.20);

  const cars = new THREE.InstancedMesh(carGeometry(), carMaterial, MAX_CARS);
  const people = new THREE.InstancedMesh(personGeometry(), personMaterial, MAX_PEOPLE);
  for (const mesh of [cars, people]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
  }
  scatterShades(cars, MAX_CARS, 0.22, 7);
  scatterShades(people, MAX_PEOPLE, 0.26, 31);

  return {
    cars,
    people,
    dispose() {
      cars.geometry.dispose();
      people.geometry.dispose();
      carMaterial.dispose();
      personMaterial.dispose();
    },
  };
}

const MATRIX = new THREE.Matrix4();
const QUATERNION = new THREE.Quaternion();
const POSITION = new THREE.Vector3();
const SCALE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 0, 1);

/**
 * Advances the agents and writes their instance matrices.
 *
 * People now turn to face their direction of travel, which they did not when
 * they were featureless boxes. With arms on them, leaving the rotation out
 * makes every pedestrian on the island face the same compass point — a
 * formation, not a crowd — and that is far more conspicuous than the occasional
 * turn-on-the-spot at a junction that the rotation costs.
 */
export function updateLife(
  handle: LifeHandle,
  cars: Agent[],
  people: Agent[],
  dt: number,
): void {
  stepAgents(cars, dt);
  stepAgents(people, dt);

  const carCount = Math.min(cars.length, MAX_CARS);
  for (let i = 0; i < carCount; i++) {
    const pose = poseOf(cars[i]);
    POSITION.set(pose.x, pose.y, pose.z);
    QUATERNION.setFromAxisAngle(UP, pose.heading);
    MATRIX.compose(POSITION, QUATERNION, SCALE);
    handle.cars.setMatrixAt(i, MATRIX);
  }
  handle.cars.count = carCount;
  handle.cars.instanceMatrix.needsUpdate = true;

  const peopleCount = Math.min(people.length, MAX_PEOPLE);
  for (let i = 0; i < peopleCount; i++) {
    const pose = poseOf(people[i]);
    POSITION.set(pose.x, pose.y, pose.z);
    QUATERNION.setFromAxisAngle(UP, pose.heading);
    MATRIX.compose(POSITION, QUATERNION, SCALE);
    handle.people.setMatrixAt(i, MATRIX);
  }
  handle.people.count = peopleCount;
  handle.people.instanceMatrix.needsUpdate = true;
}
