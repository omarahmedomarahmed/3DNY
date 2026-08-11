import { nearestEdge, outwardAt, pointInRing, toCCW } from './frame';

/**
 * Walking through the city.
 *
 * The plan is explicit that this needs no physics engine: a capsule against
 * extruded footprints is all the collision there is, and a solver would be a
 * dependency, a tick loop and a whole coordinate convention in exchange for
 * nothing. What it does need is to feel right, and that is almost entirely
 * about what happens when you walk INTO something.
 *
 * Everything here is pure and in scene metres, so it can be tested without a
 * browser — which matters, because "the camera cannot walk through a building"
 * is a claim, and a claim about a thing you can see is exactly what this
 * project's history says gets shipped broken.
 */

/** A building, as far as walking is concerned: an outline and a height. */
export interface Obstacle {
  ring: [number, number][];
  /** Metres. A walker under this height is inside the building. */
  topM: number;
  /** Metres. Usually zero; an overhang or an arcade starts higher. */
  baseM?: number;
}

/** How wide the walker is. A person's shoulders, near enough. */
export const WALKER_RADIUS_M = 0.35;

/** Eye height. The whole mode is judged from here. */
export const EYE_HEIGHT_M = 1.68;

/** Metres per second. Brisk, not a sprint — this is a walk down a street. */
export const WALK_SPEED_MS = 3.4;
export const RUN_SPEED_MS = 9.0;

/**
 * Standing on a floor inside a building, rather than on the pavement.
 *
 * The plan asks for ONE walkable floor plate, entered from its band, and this
 * is what "inside" means to the walk: the building you are in stops being
 * something to bump into and starts being something you cannot leave, and the
 * ground you are standing on is a floor slab rather than the street.
 *
 * Deliberately not a building interior in any richer sense. There are no
 * rooms, no core, no lift lobby — modelling interiors per space by hand is a
 * stated non-goal. What it answers is the question this mode exists for:
 * stand on the 14th floor and look out of its window.
 */
export interface Inside {
  buildingId: string;
  /** Metres above the building's ground. The floor slab, not the eye. */
  floorM: number;
  /** The floor plate's outline, in scene metres. */
  ring: [number, number][];
}

export interface WalkState {
  /** Metres east, metres north. */
  x: number;
  y: number;
  /** Metres above the ground the walker is standing on. */
  z: number;
  /** Degrees clockwise from north. */
  bearing: number;
  /** Degrees from straight down. 90 is level with the horizon. */
  pitch: number;
  /** Set while standing on a floor plate rather than on the pavement. */
  inside?: Inside | null;
}

export interface WalkInput {
  /** -1 back, +1 forward. */
  forward: number;
  /** -1 left, +1 right. */
  strafe: number;
  /** Degrees per second, positive turns right. */
  turn: number;
  /** Degrees per second, positive looks up. */
  look: number;
  running: boolean;
}

export const NO_INPUT: WalkInput = {
  forward: 0,
  strafe: 0,
  turn: 0,
  look: 0,
  running: false,
};

/**
 * Slides a walker along a wall rather than stopping dead against it.
 *
 * Stopping dead is the single thing that makes walking in a 3-D scene feel
 * broken: you approach a corner at an angle, catch it, and have to reverse and
 * re-aim. Sliding is what every first-person camera does and it is three lines
 * — project the blocked movement onto the wall and keep the tangential part.
 *
 * Applied per obstacle, in order, so a walker wedged into a corner is pushed
 * out of both walls rather than out of one and into the other.
 */
export function resolveCollisions(
  from: [number, number],
  to: [number, number],
  obstacles: Obstacle[],
  eyeZ: number,
  radius = WALKER_RADIUS_M,
): [number, number] {
  let [x, y] = to;

  /**
   * Three passes, because pushing out of one building can push into another.
   *
   * On a Manhattan corner two footprints meet at a shared edge, and a single
   * pass resolves the first and leaves the walker standing inside the second.
   * Three is enough for every junction in this city and it converges — each
   * pass either moves the walker or leaves them alone, and a pass that moves
   * nobody is the last one.
   */
  for (let pass = 0; pass < 3; pass++) {
  let moved = false;
  for (const o of obstacles) {
    // An arcade, a bridge, or the underside of a setback: if the walker's eye
    // is above the building there is nothing to walk into.
    if (eyeZ > o.topM) continue;
    if (o.baseM !== undefined && eyeZ < o.baseM) continue;
    if (o.ring.length < 3) continue;

    const inside = pointInRing(o.ring, x, y);
    const edge = nearestEdge(o.ring, x, y);

    if (inside) {
      /**
       * Already through the wall — push straight back out.
       *
       * The sign is the whole of this, and it was wrong first time round.
       * `nearestEdge` returns the direction FROM the wall TO the point, which
       * for a point outside the building is outward and for a point inside it
       * is inward. Adding it moved a walker who had clipped a corner deeper
       * into the tower, one step at a time, until they were standing in the
       * middle of it — which read as walls that simply did not work.
       *
       * So the walker is moved to the nearest point ON the wall and then out
       * along a direction that is TESTED rather than derived from a winding
       * nobody guarantees. The component of the movement that ran along the
       * wall is untouched, which is what makes this a slide rather than a
       * stop: walking north-east into a west-facing wall still goes north.
       *
       * The case that caught this was a walker landing exactly on a wall.
       * `pointInRing` calls that inside, `nearestEdge` has no direction to
       * offer, and the sign it falls back to depends on the ring's winding —
       * so the push went the wrong way and the walker was driven into the
       * building one step at a time until they stood in the middle of it.
       */
      const [ox, oy] = outwardAt(o.ring, edge.px, edge.py, edge.nx, edge.ny);
      x = edge.px + ox * radius;
      y = edge.py + oy * radius;
      moved = true;
      continue;
    }

    if (edge.distance >= radius) continue;

    // Outside but too close: push out to exactly the radius, keeping whatever
    // part of the movement ran ALONG the wall.
    const push = radius - edge.distance;
    x += edge.nx * push;
    y += edge.ny * push;
    moved = true;
  }
  if (!moved) break;
  }

  /**
   * A step must never teleport — but a placement is allowed to.
   *
   * When a walker is wedged between two walls the pushes fight each other and
   * the resolved point can end up further away than the step ever asked for.
   * Staying put is the honest answer there.
   *
   * That guard must NOT apply when nothing was attempted, which is how
   * `groundEntry` uses this: asking "where is the nearest legal spot to here"
   * legitimately moves a long way, and rejecting it would leave the walker
   * inside the building they were dropped into.
   */
  const attempted = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (attempted > 1e-6) {
    const travelled = Math.hypot(x - from[0], y - from[1]);
    if (travelled > attempted + radius * 4) return from;
  }

  return [x, y];
}

/**
 * One step of the walk.
 *
 * `dt` is seconds and is clamped, because a browser tab that has been in the
 * background hands back a delta of several seconds and an unclamped step would
 * put the walker through the far wall of the block.
 */
export function stepWalk(
  state: WalkState,
  input: WalkInput,
  dt: number,
  obstacles: Obstacle[],
): WalkState {
  const step = Math.min(Math.max(dt, 0), 0.1);

  const bearing = state.bearing + input.turn * step;
  /**
   * Pitch is clamped just short of straight up and straight down.
   *
   * Not a stylistic limit: the camera's own view direction is what the map's
   * centre is solved from, and at exactly 90° that solve divides by zero. It
   * is the same reason MapLibre stops at 85°, and Explore mode's whole point
   * is to go past that — so the clamp is at 88 rather than at 85.
   */
  const pitch = Math.min(88, Math.max(2, state.pitch + input.look * step));

  const speed = (input.running ? RUN_SPEED_MS : WALK_SPEED_MS) * step;
  const rad = (bearing * Math.PI) / 180;
  // Forward is the direction faced; strafe is ninety degrees clockwise of it.
  const fx = Math.sin(rad);
  const fy = Math.cos(rad);
  const sx = Math.cos(rad);
  const sy = -Math.sin(rad);

  const wantX = state.x + (fx * input.forward + sx * input.strafe) * speed;
  const wantY = state.y + (fy * input.forward + sy * input.strafe) * speed;

  if (state.inside) {
    /**
     * Inside, the walls face the other way.
     *
     * On a floor plate there is exactly one obstacle and it is the outside
     * world: the walker may go anywhere within the plate and nowhere beyond
     * it. Walking into the glass stops you at the glass, which is the correct
     * and slightly uncanny thing — you are on the 14th floor.
     */
    const [x, y] = holdInside(state.inside.ring, [state.x, state.y], [wantX, wantY]);
    return { ...state, x, y, bearing, pitch };
  }

  const [x, y] = resolveCollisions([state.x, state.y], [wantX, wantY], obstacles, state.z);

  return { ...state, x, y, bearing, pitch };
}

/** Keeps a walker within a ring rather than out of it. */
export function holdInside(
  ring: [number, number][],
  from: [number, number],
  to: [number, number],
  radius = WALKER_RADIUS_M,
): [number, number] {
  if (ring.length < 3) return to;

  const [x, y] = to;
  const edge = nearestEdge(ring, x, y);
  const inside = pointInRing(ring, x, y);

  if (inside && edge.distance >= radius) return to;

  // Either outside the plate or too close to its edge: put the walker back on
  // the plate, a walker's width in from the glass.
  const [ox, oy] = outwardAt(ring, edge.px, edge.py, edge.nx, edge.ny);
  const at: [number, number] = [edge.px - ox * radius, edge.py - oy * radius];

  // If that somehow lands outside — a plate too narrow to stand on — staying
  // put is better than being flung through the facade.
  return pointInRing(ring, at[0], at[1]) ? at : from;
}

/** Whether a point is inside any obstacle at a height. For assertions. */
export function insideAnyBuilding(
  obstacles: Obstacle[],
  x: number,
  y: number,
  z: number,
): boolean {
  for (const o of obstacles) {
    if (z > o.topM) continue;
    if (o.baseM !== undefined && z < o.baseM) continue;
    if (pointInRing(o.ring, x, y)) return true;
  }
  return false;
}

/**
 * Somewhere to stand, given a place you would like to be.
 *
 * Entering the walk from a drone camera hovering over a rooftop has to land
 * the walker on the pavement rather than inside the tower they were looking
 * at. The nearest point outside every obstacle is the answer, and it is found
 * by simply resolving collisions from the requested spot — which is the same
 * code path a step takes, so a place the entry finds is a place a walk can be.
 */
export function groundEntry(
  at: [number, number],
  obstacles: Obstacle[],
  eyeZ = EYE_HEIGHT_M,
): [number, number] {
  // Two passes, because pushing out of one building can push into its
  // neighbour on a dense block. Two is enough for every Manhattan corner;
  // a third would be chasing a case that needs a different approach anyway.
  let point = resolveCollisions(at, at, obstacles, eyeZ, WALKER_RADIUS_M * 2);
  point = resolveCollisions(point, point, obstacles, eyeZ, WALKER_RADIUS_M * 2);
  return point;
}
