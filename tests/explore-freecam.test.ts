import { describe, expect, it } from 'vitest';
import {
  FREE_FAST_MULTIPLIER,
  FREE_MAX_Z,
  FREE_MIN_Z,
  FREE_SPEED_MS,
  MAX_PITCH_DEG,
  NO_FREE_INPUT,
  freeForward,
  freeRight,
  stepFree,
  wrapDeg,
  type FreeCam,
} from '@/lib/explore/freecam';

const AT = (over: Partial<FreeCam> = {}): FreeCam => ({
  x: 0,
  y: 0,
  z: 100,
  yaw: 0,
  pitch: 0,
  ...over,
});

const input = (over: Partial<typeof NO_FREE_INPUT> = {}) => ({ ...NO_FREE_INPUT, ...over });

describe('wrapDeg', () => {
  it('brings any angle into [0, 360)', () => {
    expect(wrapDeg(0)).toBe(0);
    expect(wrapDeg(360)).toBe(0);
    expect(wrapDeg(370)).toBeCloseTo(10);
    expect(wrapDeg(-10)).toBeCloseTo(350);
    expect(wrapDeg(-730)).toBeCloseTo(350);
  });
});

describe('freeForward', () => {
  it('yaw 0 looks north', () => {
    const [e, n, u] = freeForward(AT());
    expect(e).toBeCloseTo(0);
    expect(n).toBeCloseTo(1);
    expect(u).toBeCloseTo(0);
  });

  it('yaw is clockwise: 90 looks east', () => {
    const [e, n] = freeForward(AT({ yaw: 90 }));
    expect(e).toBeCloseTo(1);
    expect(n).toBeCloseTo(0);
  });

  it('yaw 180 looks south and 270 west', () => {
    expect(freeForward(AT({ yaw: 180 }))[1]).toBeCloseTo(-1);
    expect(freeForward(AT({ yaw: 270 }))[0]).toBeCloseTo(-1);
  });

  it('positive pitch points above the horizon', () => {
    // The whole reason this camera exists: MapLibre cannot produce this vector.
    expect(freeForward(AT({ pitch: 45 }))[2]).toBeCloseTo(Math.SQRT1_2);
    expect(freeForward(AT({ pitch: -30 }))[2]).toBeCloseTo(-0.5);
  });

  it('is a unit vector at every attitude', () => {
    for (const yaw of [0, 37, 123, 271, 359]) {
      for (const pitch of [-89, -45, 0, 45, 89]) {
        const [e, n, u] = freeForward(AT({ yaw, pitch }));
        expect(Math.hypot(e, n, u)).toBeCloseTo(1);
      }
    }
  });
});

describe('freeRight', () => {
  it('is level and perpendicular to the look direction', () => {
    for (const yaw of [0, 45, 200, 330]) {
      for (const pitch of [-60, 0, 80]) {
        const cam = AT({ yaw, pitch });
        const f = freeForward(cam);
        const r = freeRight(cam);
        expect(r[2]).toBe(0);
        expect(f[0] * r[0] + f[1] * r[1] + f[2] * r[2]).toBeCloseTo(0);
      }
    }
  });

  it('right of north is east', () => {
    const [e, n] = freeRight(AT());
    expect(e).toBeCloseTo(1);
    expect(n).toBeCloseTo(0);
  });
});

describe('stepFree', () => {
  it('does nothing with no input', () => {
    const before = AT({ x: 5, y: -3, yaw: 40, pitch: 12 });
    expect(stepFree(before, input(), 1)).toEqual(before);
  });

  it('forward moves along the look direction at the stated speed', () => {
    const after = stepFree(AT(), input({ forward: 1 }), 1);
    expect(after.y).toBeCloseTo(FREE_SPEED_MS);
    expect(after.x).toBeCloseTo(0);
    expect(after.z).toBeCloseTo(100);
  });

  it('shift multiplies the speed and nothing else', () => {
    const slow = stepFree(AT(), input({ forward: 1 }), 1);
    const fast = stepFree(AT(), input({ forward: 1, fast: true }), 1);
    expect(fast.y).toBeCloseTo(slow.y * FREE_FAST_MULTIPLIER);
    expect(fast.yaw).toBe(slow.yaw);
  });

  it('flying forward while looking up gains height', () => {
    // The behaviour a camera that can point up has to have, and the thing a
    // map camera cannot do at all.
    const after = stepFree(AT({ pitch: 90 - 1e-9 }), input({ forward: 1 }), 1);
    expect(after.z).toBeGreaterThan(100);
  });

  it('rise climbs without changing where the camera looks', () => {
    const after = stepFree(AT({ pitch: -40, yaw: 220 }), input({ rise: 1 }), 1);
    expect(after.z).toBeCloseTo(100 + FREE_SPEED_MS);
    expect(after.x).toBeCloseTo(0);
    expect(after.y).toBeCloseTo(0);
    expect(after.pitch).toBe(-40);
    expect(after.yaw).toBe(220);
  });

  it('strafe moves sideways, not along the view', () => {
    const after = stepFree(AT(), input({ strafe: 1 }), 1);
    expect(after.x).toBeCloseTo(FREE_SPEED_MS);
    expect(after.y).toBeCloseTo(0);
  });

  it('turns before it moves, so a step is not a frame behind the look', () => {
    // Yaw 90 applied this frame must send the camera east, not north.
    const after = stepFree(AT(), input({ forward: 1, dYaw: 90 }), 1);
    expect(after.x).toBeCloseTo(FREE_SPEED_MS);
    expect(after.y).toBeCloseTo(0);
  });

  it('yaw wraps rather than accumulating', () => {
    expect(stepFree(AT({ yaw: 350 }), input({ dYaw: 20 }), 1).yaw).toBeCloseTo(10);
    expect(stepFree(AT({ yaw: 5 }), input({ dYaw: -20 }), 1).yaw).toBeCloseTo(345);
  });

  it('pitch clamps just short of vertical, both ways', () => {
    expect(stepFree(AT(), input({ dPitch: 500 }), 1).pitch).toBe(MAX_PITCH_DEG);
    expect(stepFree(AT(), input({ dPitch: -500 }), 1).pitch).toBe(-MAX_PITCH_DEG);
    // Short of 90, so the look-at basis can never degenerate.
    expect(MAX_PITCH_DEG).toBeLessThan(90);
  });

  it('never goes below the pavement or above the ceiling', () => {
    expect(stepFree(AT({ z: 3 }), input({ rise: -1 }), 1).z).toBe(FREE_MIN_Z);
    expect(stepFree(AT({ z: FREE_MAX_Z - 1 }), input({ rise: 1 }), 1).z).toBe(FREE_MAX_Z);
  });

  it('scales with the timestep', () => {
    const tenth = stepFree(AT(), input({ forward: 1 }), 0.1);
    expect(tenth.y).toBeCloseTo(FREE_SPEED_MS * 0.1);
  });

  it('is pure — the camera it was given is untouched', () => {
    const before = AT();
    const copy = { ...before };
    stepFree(before, input({ forward: 1, dYaw: 30, rise: 1 }), 1);
    expect(before).toEqual(copy);
  });
});
