/**
 * The unconstrained camera.
 *
 * MapLibre's camera is a map camera: it looks down at the ground from an
 * altitude, it can pitch to 85 degrees and no further, and 90 degrees is the
 * horizon. So on MapLibre's camera it is not merely awkward to look above eye
 * level — it is arithmetically impossible. That is the correct constraint for a
 * map and the wrong one for a model that now has a sky, a sun, clouds and
 * thousand-foot towers in it, because the one thing anybody does standing at
 * the foot of a skyscraper is look up.
 *
 * This is the camera Explore mode uses when the free-look button is on. It is
 * plain state and plain trigonometry — no three.js, no DOM — so the parts that
 * decide where you end up are unit tested rather than eyeballed.
 *
 * ## The frame
 *
 * Same as the rest of Explore: metres, +X east, +Y north, +Z up.
 *
 * | | |
 * |---|---|
 * | `yaw` | Degrees clockwise from north, unbounded and wrapped — this is the 360 |
 * | `pitch` | Degrees above the horizon. Negative looks down. Clamped just inside ±90 |
 *
 * Pitch stops at 89.5° rather than 90° on purpose. At exactly straight up the
 * forward vector is parallel to the world up vector, `lookAt` has no way to
 * choose a roll, and the view snaps through a half turn. Half a degree short is
 * indistinguishable to look at and cannot degenerate.
 */

export interface FreeCam {
  x: number;
  y: number;
  z: number;
  /** Degrees clockwise from north. */
  yaw: number;
  /** Degrees above the horizon, negative for down. */
  pitch: number;
}

export interface FreeInput {
  /** +1 forward along the look direction, −1 back. */
  forward: number;
  /** +1 right, −1 left, perpendicular to the look direction and level. */
  strafe: number;
  /** +1 up, −1 down. Straight up in the world, not up the view. */
  rise: number;
  /** Degrees to add to yaw and pitch this frame. */
  dYaw: number;
  dPitch: number;
  fast: boolean;
}

export const NO_FREE_INPUT: FreeInput = {
  forward: 0,
  strafe: 0,
  rise: 0,
  dYaw: 0,
  dPitch: 0,
  fast: false,
};

/**
 * Metres per second.
 *
 * A drone's pace, not a walker's: the free camera exists to cross the model and
 * look at things from angles the map camera cannot reach, and at walking speed
 * getting from Midtown to the Battery is a minute of holding a key. Shift is
 * four times faster again, which crosses the loaded market in a few seconds.
 */
export const FREE_SPEED_MS = 90;
export const FREE_FAST_MULTIPLIER = 8;

/**
 * Indoors, at a person's pace.
 *
 * The flying speed exists to cross a market; a floor plate is forty metres
 * across and at 90 m/s you traverse it in under half a second, which makes a
 * room impossible to look at.
 *
 * 1.9 m/s was a walking pace and it was too literal — you are not simulating a
 * person, you are inspecting a room, and crossing a large plate took twenty
 * seconds of holding a key. This is a jog: fast enough to get to the far
 * window without waiting, slow enough that the furniture still gives you
 * scale on the way.
 */
export const INSIDE_SPEED_MS = 5.4;

/**
 * Shift indoors, at a fraction of the outdoor multiplier.
 *
 * Shift used to do nothing inside a space, on the grounds that eight times a
 * flying speed crosses a floor plate in a fifth of a second. That was right
 * about the multiplier and wrong about the conclusion: crossing a large plate
 * to reach the far window is exactly the thing you want to do quickly, and
 * having the key silently do nothing reads as the mode being broken. Two and a
 * half times a jog is a run across a room.
 */
export const INSIDE_FAST_MULTIPLIER = 2.5;

/** Nothing may go below the pavement, and nothing needs to go above the clouds. */
export const FREE_MIN_Z = 1.5;
export const FREE_MAX_Z = 4000;

export const MAX_PITCH_DEG = 89.5;

/** Wraps into [0, 360). Yaw is a direction, not a count of turns. */
export function wrapDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Unit vector the camera looks along, in scene metres. */
export function freeForward(cam: FreeCam): [number, number, number] {
  const yaw = (cam.yaw * Math.PI) / 180;
  const pitch = (cam.pitch * Math.PI) / 180;
  const horizontal = Math.cos(pitch);
  // Yaw is clockwise from north, so it drives sin into east and cos into north
  // — the reverse of the usual maths convention, and the same convention
  // `sun.ts` uses for azimuth. Mixing the two silently mirrors the world.
  return [
    Math.sin(yaw) * horizontal,
    Math.cos(yaw) * horizontal,
    Math.sin(pitch),
  ];
}

/** Unit vector to the camera's right, level with the ground. */
export function freeRight(cam: FreeCam): [number, number, number] {
  const yaw = (cam.yaw * Math.PI) / 180;
  return [Math.cos(yaw), -Math.sin(yaw), 0];
}

/**
 * One frame of movement.
 *
 * Movement is along the look direction including its pitch, so pointing up and
 * holding forward climbs — which is what everyone expects from a camera that
 * can point up, and the reason `rise` exists separately is for the times you
 * want to gain height without changing what you are looking at.
 */
export function stepFree(
  cam: FreeCam,
  input: FreeInput,
  dt: number,
  /** Metres per second before the Shift multiplier. Indoors this is slower. */
  speedMs: number = FREE_SPEED_MS,
): FreeCam {
  const yaw = wrapDeg(cam.yaw + input.dYaw);
  const pitch = Math.max(
    -MAX_PITCH_DEG,
    Math.min(MAX_PITCH_DEG, cam.pitch + input.dPitch),
  );
  const turned: FreeCam = { ...cam, yaw, pitch };

  const multiplier =
    speedMs === INSIDE_SPEED_MS ? INSIDE_FAST_MULTIPLIER : FREE_FAST_MULTIPLIER;
  const speed = speedMs * (input.fast ? multiplier : 1) * dt;
  const f = freeForward(turned);
  const r = freeRight(turned);

  const x = cam.x + (f[0] * input.forward + r[0] * input.strafe) * speed;
  const y = cam.y + (f[1] * input.forward + r[1] * input.strafe) * speed;
  const z = cam.z + (f[2] * input.forward + input.rise) * speed;

  return {
    x,
    y,
    z: Math.max(FREE_MIN_Z, Math.min(FREE_MAX_Z, z)),
    yaw,
    pitch,
  };
}
