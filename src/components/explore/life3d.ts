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
 * **Shape.** A car is a box with a smaller box on it and a person is a
 * capsule-ish box. At the distance a car is ever more than four pixels wide,
 * the silhouette and the motion are the whole of what reads; anything more
 * detailed is triangles spent where nobody is looking.
 */

export interface LifeHandle {
  cars: THREE.InstancedMesh;
  people: THREE.InstancedMesh;
  dispose(): void;
}

/** How many of each the scene will draw. Beyond this they are texture. */
export const MAX_CARS = 900;
export const MAX_PEOPLE = 1400;

/** A saloon: 4.4 m long, 1.9 m wide, 1.45 m tall, with a cabin on top. */
function carGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(4.4, 1.9, 0.85);
  body.translate(0, 0, 0.42);
  const cabin = new THREE.BoxGeometry(2.3, 1.7, 0.6);
  cabin.translate(-0.15, 0, 1.12);

  // Merged by hand rather than with BufferGeometryUtils, which would pull a
  // second module in for two boxes.
  const merged = new THREE.BufferGeometry();
  const parts = [body, cabin];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const part of parts) {
    const p = part.getAttribute('position');
    const n = part.getAttribute('normal');
    const index = part.getIndex();
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    if (index) for (let i = 0; i < index.count; i++) indices.push(offset + index.getX(i));
    offset += p.count;
    part.dispose();
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}

/** A person: 0.45 m across, 1.7 m tall, standing on the pavement. */
function personGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.4, 0.45, 1.7);
  g.translate(0, 0, 0.85);
  return g;
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
  return new THREE.MeshBasicMaterial({ color: grey });
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
 * People are not turned to face their direction of travel. A box rotating on
 * the spot at a junction is worse than a box that does not, and at the size a
 * person is drawn nobody can tell which way they are pointing anyway.
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
  QUATERNION.identity();
  for (let i = 0; i < peopleCount; i++) {
    const pose = poseOf(people[i]);
    POSITION.set(pose.x, pose.y, pose.z);
    MATRIX.compose(POSITION, QUATERNION, SCALE);
    handle.people.setMatrixAt(i, MATRIX);
  }
  handle.people.count = peopleCount;
  handle.people.instanceMatrix.needsUpdate = true;
}
