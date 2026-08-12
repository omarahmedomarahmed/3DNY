import { describe, expect, it } from 'vitest';
import {
  FRAME_MARGIN,
  MIN_DISTANCE_M,
  ORBIT_PERIOD_S,
  advanceOrbit,
  blendCamera,
  ease,
  frameDistance,
  orbitCamera,
  orbitFocus,
  shortestTurn,
  startOrbit,
  transitionSeconds,
  type OrbitSubject,
} from '@/lib/explore/orbit';
import type { FreeCam } from '@/lib/explore/freecam';

/**
 * The locked orbit.
 *
 * Everything here decides where a camera ends up, which is exactly the class of
 * thing that looks plausible in code and turns out to be inside a building. The
 * two properties that matter most — the subject stays in frame, and the camera
 * never ends up underground or inside its own subject — are asserted across a
 * range of real building shapes rather than on one example.
 */

const VFOV = 45;
const ASPECT = 16 / 9;

function subject(height: number, radius = 30): OrbitSubject {
  return { cx: 0, cy: 0, baseM: 0, roofM: height, radiusM: radius };
}

/** The half-angle the subject subtends vertically from a given camera. */
function verticalHalfAngle(s: OrbitSubject, ground: number): number {
  const eye = s.roofM;
  const mid = (s.baseM + s.roofM) / 2;
  const slant = Math.hypot(ground, eye - mid);
  return (Math.atan(((s.roofM - s.baseM) / 2) / slant) * 180) / Math.PI;
}

describe('frameDistance', () => {
  it('puts the whole building inside the field of view', () => {
    // The property the feature is named for. If this fails the top of the
    // building is cropped and the shot is worthless.
    for (const h of [12, 40, 90, 180, 320, 440]) {
      const s = subject(h);
      const d = frameDistance(s, VFOV, ASPECT);
      expect(verticalHalfAngle(s, d)).toBeLessThanOrEqual(VFOV / 2);
    }
  });

  it('leaves room above the roof for the name-plate card', () => {
    const s = subject(200);
    const d = frameDistance(s, VFOV, ASPECT);
    // Comfortably inside, not touching the edge — the margin is the card.
    expect(verticalHalfAngle(s, d)).toBeLessThan((VFOV / 2) * (1 - FRAME_MARGIN / 3));
  });

  it('stands further back from a taller building', () => {
    const near = frameDistance(subject(60), VFOV, ASPECT);
    const far = frameDistance(subject(380), VFOV, ASPECT);
    expect(far).toBeGreaterThan(near);
  });

  it('stands further back from a wider one of the same height', () => {
    // A squat block is limited by its footprint, not its height — the whole
    // reason the solve runs twice.
    const thin = frameDistance(subject(40, 15), VFOV, ASPECT);
    const wide = frameDistance(subject(40, 160), VFOV, ASPECT);
    expect(wide).toBeGreaterThan(thin);
  });

  it('never stands inside a small building', () => {
    const s = subject(8, 12);
    expect(frameDistance(s, VFOV, ASPECT)).toBeGreaterThanOrEqual(MIN_DISTANCE_M);
    expect(frameDistance(s, VFOV, ASPECT)).toBeGreaterThan(s.radiusM);
  });

  it('is finite for a degenerate subject', () => {
    // A building with no height and no footprint is a data error, not a crash.
    const d = frameDistance({ cx: 0, cy: 0, baseM: 10, roofM: 10, radiusM: 0 }, VFOV, ASPECT);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(0);
  });

  it('stands closer through a wider lens', () => {
    const tight = frameDistance(subject(150), 30, ASPECT);
    const wide = frameDistance(subject(150), 70, ASPECT);
    expect(wide).toBeLessThan(tight);
  });
});

describe('orbitCamera', () => {
  const s = subject(150, 40);
  const orbit = { subject: s, distanceM: 400, angleDeg: 0, periodS: ORBIT_PERIOD_S };

  it('rides at roof height', () => {
    // The user's own framing: the point of view is fixed to the roof, so every
    // building has its own orbit altitude.
    expect(orbitCamera(orbit).z).toBe(s.roofM);
  });

  it('stays the solved distance from the axis, all the way round', () => {
    for (let a = 0; a < 360; a += 17) {
      const cam = orbitCamera({ ...orbit, angleDeg: a });
      expect(Math.hypot(cam.x - s.cx, cam.y - s.cy)).toBeCloseTo(400, 6);
    }
  });

  it('always looks at the building, from any angle', () => {
    // The one thing the viewer will notice instantly if it drifts.
    const [fx, fy] = orbitFocus(s);
    for (let a = 0; a < 360; a += 23) {
      const cam = orbitCamera({ ...orbit, angleDeg: a });
      const wanted = (Math.atan2(fx - cam.x, fy - cam.y) * 180) / Math.PI;
      const drift = shortestTurn(cam.yaw, wanted);
      expect(Math.abs(drift)).toBeLessThan(1e-6);
    }
  });

  it('looks slightly down, never up', () => {
    // Riding at roof height and aiming at mid-height, up would mean the aim is
    // above the building.
    for (let a = 0; a < 360; a += 45) {
      expect(orbitCamera({ ...orbit, angleDeg: a }).pitch).toBeLessThan(0);
    }
  });

  it('never puts the eye below the pavement', () => {
    for (const h of [6, 30, 120, 400]) {
      const cam = orbitCamera({
        subject: subject(h),
        distanceM: frameDistance(subject(h), VFOV, ASPECT),
        angleDeg: 90,
        periodS: ORBIT_PERIOD_S,
      });
      expect(cam.z).toBeGreaterThan(0);
    }
  });

  it('goes east at ninety degrees, north at zero', () => {
    // Yaw is clockwise from north here and anti-clockwise from east in the
    // usual maths convention. Mixing them mirrors the city, which has cost
    // this codebase hours before.
    expect(orbitCamera({ ...orbit, angleDeg: 0 }).y).toBeGreaterThan(s.cy);
    expect(orbitCamera({ ...orbit, angleDeg: 90 }).x).toBeGreaterThan(s.cx);
  });
});

describe('startOrbit', () => {
  const s = subject(200, 45);

  it('starts on the side the camera was already on', () => {
    // Otherwise clicking a building swings you round to its far side, and the
    // face you chose it for is the one you stop seeing.
    const from: FreeCam = { x: 0, y: -900, z: 200, yaw: 0, pitch: 0 };
    const orbit = startOrbit(s, from, VFOV, ASPECT);
    const cam = orbitCamera(orbit);
    expect(cam.y).toBeLessThan(s.cy);
    expect(Math.abs(cam.x - s.cx)).toBeLessThan(1);
  });

  it('dollies in when the camera started too far away', () => {
    const from: FreeCam = { x: 0, y: -4000, z: 300, yaw: 0, pitch: 0 };
    const orbit = startOrbit(s, from, VFOV, ASPECT);
    expect(orbit.distanceM).toBeLessThan(4000);
  });

  it('dollies out when the camera started on top of it', () => {
    // Both directions from one solve — the ask was explicitly "in or out".
    const from: FreeCam = { x: 5, y: -20, z: 40, yaw: 0, pitch: 0 };
    const orbit = startOrbit(s, from, VFOV, ASPECT);
    expect(orbit.distanceM).toBeGreaterThan(20);
  });

  it('does not divide by zero on the axis', () => {
    const from: FreeCam = { x: s.cx, y: s.cy, z: 500, yaw: 0, pitch: -90 };
    const orbit = startOrbit(s, from, VFOV, ASPECT);
    expect(Number.isFinite(orbit.angleDeg)).toBe(true);
  });
});

describe('advanceOrbit', () => {
  const orbit = {
    subject: subject(100),
    distanceM: 300,
    angleDeg: 0,
    periodS: ORBIT_PERIOD_S,
  };

  it('completes exactly one revolution in its period', () => {
    let o = orbit;
    for (let i = 0; i < ORBIT_PERIOD_S * 60; i++) o = advanceOrbit(o, 1 / 60);
    // Compared as an angle rather than as a number: 2,700 additions of a
    // sixtieth land a hair *short* of the full turn, so the raw value is
    // 359.999…, which is zero degrees away from where it started.
    expect(Math.abs(shortestTurn(0, o.angleDeg))).toBeLessThan(1e-6);
  });

  it('is halfway round at half the period', () => {
    let o = orbit;
    for (let i = 0; i < (ORBIT_PERIOD_S / 2) * 60; i++) o = advanceOrbit(o, 1 / 60);
    expect(o.angleDeg).toBeCloseTo(180, 4);
  });

  it('wraps rather than counting turns', () => {
    let o = { ...orbit, angleDeg: 359 };
    o = advanceOrbit(o, 1);
    expect(o.angleDeg).toBeGreaterThanOrEqual(0);
    expect(o.angleDeg).toBeLessThan(360);
  });

  it('does not move the subject or the distance', () => {
    const o = advanceOrbit(orbit, 3.5);
    expect(o.distanceM).toBe(orbit.distanceM);
    expect(o.subject).toBe(orbit.subject);
  });
});

describe('the move into the lock', () => {
  it('turns the short way round', () => {
    expect(shortestTurn(350, 10)).toBeCloseTo(20);
    expect(shortestTurn(10, 350)).toBeCloseTo(-20);
    expect(Math.abs(shortestTurn(0, 180))).toBeCloseTo(180);
  });

  it('eases in and out rather than starting at full speed', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    // Slow at both ends is what makes it read as a camera move.
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(0.9)).toBeGreaterThan(0.9);
  });

  it('arrives exactly where it was aimed', () => {
    const from: FreeCam = { x: 0, y: 0, z: 10, yaw: 350, pitch: 5 };
    const to: FreeCam = { x: 100, y: 50, z: 200, yaw: 10, pitch: -12 };
    const end = blendCamera(from, to, 1);
    expect(end.x).toBeCloseTo(to.x);
    expect(end.z).toBeCloseTo(to.z);
    expect(end.yaw).toBeCloseTo(to.yaw);
    expect(end.pitch).toBeCloseTo(to.pitch);
  });

  it('never swings the long way through the wrap', () => {
    const from: FreeCam = { x: 0, y: 0, z: 10, yaw: 350, pitch: 0 };
    const to: FreeCam = { x: 0, y: 0, z: 10, yaw: 10, pitch: 0 };
    // Every intermediate heading is within the twenty-degree arc, never out
    // through 180.
    for (let t = 0; t <= 1; t += 0.05) {
      const yaw = blendCamera(from, to, t).yaw;
      expect(yaw > 349 || yaw < 11).toBe(true);
    }
  });

  it('takes longer for a longer move, within bounds', () => {
    const here: FreeCam = { x: 0, y: 0, z: 100, yaw: 0, pitch: 0 };
    const near: FreeCam = { x: 30, y: 0, z: 100, yaw: 0, pitch: 0 };
    const far: FreeCam = { x: 5000, y: 0, z: 100, yaw: 0, pitch: 0 };
    expect(transitionSeconds(here, near)).toBeLessThan(transitionSeconds(here, far));
    expect(transitionSeconds(here, near)).toBeGreaterThanOrEqual(1.1);
    expect(transitionSeconds(here, far)).toBeLessThanOrEqual(4);
  });
});
