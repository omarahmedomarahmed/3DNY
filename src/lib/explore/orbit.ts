/**
 * The locked orbit — a camera on a track around one building.
 *
 * ## What it is for
 *
 * Free look is for getting somewhere. This is for *looking at one thing*: you
 * click a building, the camera stops being yours to steer, moves to the one
 * distance where that building fits the frame whole, and circles it with the
 * point of view pinned to its centre. The building stays still in the middle of
 * the screen and the city sweeps behind it.
 *
 * It is a product shot. The building is the subject and everything else is set
 * dressing, which is why the surrounding city is hidden by default while it
 * runs — see `useExplore`.
 *
 * ## Why the framing is derived rather than chosen
 *
 * "Far enough away to see the building" is not one distance. A six-storey loft
 * and the Chrysler Building need distances an order of magnitude apart, and a
 * fixed one either buries the small building in the middle of the frame or
 * crops the top off the tall one. So the distance is solved for, per building,
 * from its own height and footprint and the camera's own field of view: the
 * distance at which **base and roof both sit inside the frame**, with room left
 * for the name-plate card.
 *
 * The eye rides at roof height. That was a deliberate choice and it is what
 * makes the shot read: level with the roof you are looking slightly down at the
 * building, the way every architectural photograph of a tower is taken, and the
 * horizon sits behind it rather than through it.
 *
 * ## The frame
 *
 * Same as the rest of Explore — metres, +X east, +Y north, +Z up — and the
 * camera it produces is the same `FreeCam` free look uses, so stopping the
 * orbit is a hand-off and not a mode change: the camera simply stops being
 * driven from here and starts being driven by the keyboard, from exactly where
 * it stood.
 *
 * Everything in this file is plain trigonometry with no three.js and no DOM,
 * because where a cinematic camera ends up is precisely the kind of thing that
 * looks fine until it is inside a building.
 */

import { MAX_PITCH_DEG, wrapDeg, type FreeCam } from './freecam';

/**
 * A building, reduced to what framing it actually needs.
 *
 * Not the geometry — the orbit does not care about the shape, only about how
 * much of the frame the shape will take up.
 */
export interface OrbitSubject {
  /** Scene metres. The footprint's centre, not the centroid of the mesh. */
  cx: number;
  cy: number;
  /** Pavement, which is not always zero. */
  baseM: number;
  /** The roof. */
  roofM: number;
  /** How far the footprint reaches from its centre, at its widest. */
  radiusM: number;
}

export interface OrbitState {
  subject: OrbitSubject;
  /** Horizontal distance from the axis, solved by `frameDistance`. */
  distanceM: number;
  /** Degrees clockwise from north — where on the circle the camera is now. */
  angleDeg: number;
  /** Seconds for one full revolution. */
  periodS: number;
}

/**
 * One full circle in forty-five seconds.
 *
 * Slow enough to read as a camera move rather than a turntable, fast enough
 * that you see the other side of the building without waiting for it. Eight
 * degrees a second.
 */
export const ORBIT_PERIOD_S = 45;

/**
 * Room left around the building, as a fraction of its height.
 *
 * The name-plate card sits above the roof in free look and has to stay in the
 * shot, and a subject that touches both edges of the frame reads as cramped
 * however correct the arithmetic is.
 */
export const FRAME_MARGIN = 0.28;

/**
 * Nothing orbits closer than this.
 *
 * A two-storey building solves to a distance of a few metres, which puts the
 * camera inside the shopfront opposite and clips through its own subject on
 * every revolution. Forty metres is about the width of an avenue.
 */
export const MIN_DISTANCE_M = 40;

/** And nothing needs to orbit from further than this. */
export const MAX_DISTANCE_M = 2600;

/**
 * How far back the camera has to stand for the whole building to fit.
 *
 * Solved in the camera's own frame, not the world's. The half-angle a subject
 * of half-extent `h` subtends at distance `L` is `atan(h / L)`, so fitting it
 * inside a field of view of `fov` needs `L >= h / tan(fov / 2)`. That is done
 * twice — once vertically against the building's height, once horizontally
 * against its footprint — and the larger wins, because a squat block a hundred
 * metres wide is limited by its width and a tower is limited by its height.
 *
 * `L` is the slant range to the building's mid-height. The camera rides at roof
 * level, so the ground distance is the leg of a right triangle whose other leg
 * is half the building's height — which is why this returns a *ground* distance
 * and not the hypotenuse it solved.
 */
export function frameDistance(
  subject: OrbitSubject,
  vfovDeg: number,
  aspect: number,
): number {
  const height = Math.max(1, subject.roofM - subject.baseM);
  const halfHeight = height / 2;

  const vfov = (Math.max(1, Math.min(179, vfovDeg)) * Math.PI) / 180;
  // Horizontal field of view follows from the vertical one and the aspect
  // ratio; a wide window sees more sideways, not more upward.
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(0.2, aspect));

  const wantedV = halfHeight * (1 + FRAME_MARGIN);
  const wantedH = Math.max(1, subject.radiusM) * (1 + FRAME_MARGIN);

  const slant = Math.max(
    wantedV / Math.tan(vfov / 2),
    wantedH / Math.tan(hfov / 2),
  );

  // The camera is `halfHeight` above the point it is looking at, so the ground
  // leg is shorter than the slant range. On a very tall, very thin building the
  // slant can be shorter than that leg, in which case there is no triangle and
  // the ground distance collapses to the floor below.
  const ground = Math.sqrt(Math.max(0, slant * slant - halfHeight * halfHeight));

  return Math.max(MIN_DISTANCE_M, Math.min(MAX_DISTANCE_M, ground));
}

/** The point the camera looks at: the middle of the building, not its roof. */
export function orbitFocus(subject: OrbitSubject): [number, number, number] {
  return [subject.cx, subject.cy, (subject.baseM + subject.roofM) / 2];
}

/**
 * Begin an orbit around a subject, framed for the window it will be shown in.
 *
 * The starting angle is where the camera already is, so the move into the lock
 * is a dolly rather than a swing around to the far side — you keep looking at
 * the face of the building you chose.
 */
export function startOrbit(
  subject: OrbitSubject,
  from: FreeCam,
  vfovDeg: number,
  aspect: number,
  periodS: number = ORBIT_PERIOD_S,
): OrbitState {
  const dx = from.x - subject.cx;
  const dy = from.y - subject.cy;
  // Degenerate only if the camera is exactly on the axis, in which case any
  // angle is as good as any other and north is as good as any.
  const angleDeg =
    Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6
      ? 0
      : wrapDeg((Math.atan2(dx, dy) * 180) / Math.PI);

  return {
    subject,
    distanceM: frameDistance(subject, vfovDeg, aspect),
    angleDeg,
    periodS,
  };
}

/**
 * Where the camera stands, and which way it faces, at the orbit's current
 * angle.
 *
 * The eye rides at roof height and the aim is the building's mid-height, so the
 * pitch is always slightly downward and is derived rather than stored — there
 * is no combination of state that can put the orbit's aim somewhere other than
 * the building.
 */
export function orbitCamera(orbit: OrbitState): FreeCam {
  const { subject, distanceM, angleDeg } = orbit;
  const a = (angleDeg * Math.PI) / 180;

  // Same convention as `freeForward`: clockwise from north, so sin drives east.
  const x = subject.cx + Math.sin(a) * distanceM;
  const y = subject.cy + Math.cos(a) * distanceM;
  const z = subject.roofM;

  const [fx, fy, fz] = orbitFocus(subject);
  const yaw = wrapDeg((Math.atan2(fx - x, fy - y) * 180) / Math.PI);
  const pitch = Math.max(
    -MAX_PITCH_DEG,
    Math.min(MAX_PITCH_DEG, (Math.atan2(fz - z, distanceM) * 180) / Math.PI),
  );

  return { x, y, z, yaw, pitch };
}

/** Advance the orbit by one frame. Positive is clockwise seen from above. */
export function advanceOrbit(orbit: OrbitState, dt: number): OrbitState {
  const perRevolution = 360 / Math.max(1, orbit.periodS);
  return { ...orbit, angleDeg: wrapDeg(orbit.angleDeg + perRevolution * dt) };
}

/** Smoothstep. Ease in and ease out, zero slope at both ends. */
export function ease(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * The shorter way round from one heading to another, in degrees.
 *
 * Without this a transition from 350° to 10° turns 340 degrees the wrong way —
 * which on a two-second cinematic move is not a subtle defect.
 */
export function shortestTurn(fromDeg: number, toDeg: number): number {
  return ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
}

/**
 * Interpolate one camera toward another.
 *
 * Used for the move into the lock, which is the whole reason the feature reads
 * as cinematic rather than as a cut. Position is linear and heading takes the
 * short way round.
 */
export function blendCamera(from: FreeCam, to: FreeCam, t: number): FreeCam {
  const k = ease(t);
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    z: from.z + (to.z - from.z) * k,
    yaw: wrapDeg(from.yaw + shortestTurn(from.yaw, to.yaw) * k),
    pitch: from.pitch + (to.pitch - from.pitch) * k,
  };
}

/**
 * How long the move into the lock should take.
 *
 * Scaled with the distance travelled, because a fixed duration is either a
 * lurch when the camera was already close or a crawl when it has to cross half
 * of Midtown. Bounded at both ends: under a second reads as a cut, over four
 * seconds is a wait.
 */
export function transitionSeconds(from: FreeCam, to: FreeCam): number {
  const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  return Math.max(1.1, Math.min(4, 1.1 + d / 420));
}
