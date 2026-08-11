import { describe, expect, it } from 'vitest';
import {
  resolveCollisions,
  stepWalk,
  groundEntry,
  insideAnyBuilding,
  EYE_HEIGHT_M,
  WALKER_RADIUS_M,
  WALK_SPEED_MS,
  RUN_SPEED_MS,
  NO_INPUT,
  type Obstacle,
  type WalkState,
} from '@/lib/explore/walk';

/**
 * Walking, and the one claim that has to hold: you cannot get inside a
 * building.
 *
 * This is checked here rather than only in the browser because it is a claim
 * about geometry, and because a browser check can only ever try a handful of
 * paths. Here a walker can be marched into a wall from a thousand directions
 * in a millisecond.
 */

/** A 40 x 30 m block, 60 m tall, with its south-west corner at the origin. */
const BLOCK: Obstacle = {
  ring: [[0, 0], [40, 0], [40, 30], [0, 30]],
  topM: 60,
};

/** Two blocks with a three-metre alley between them. */
const ALLEY: Obstacle[] = [
  BLOCK,
  { ring: [[43, 0], [83, 0], [83, 30], [43, 30]], topM: 60 },
];

const START: WalkState = { x: -10, y: 15, z: EYE_HEIGHT_M, bearing: 90, pitch: 84 };

describe('the wall', () => {
  it('stops a walker short of it, by their own radius', () => {
    const at = resolveCollisions([-5, 15], [5, 15], [BLOCK], EYE_HEIGHT_M);
    expect(at[0]).toBeLessThanOrEqual(-WALKER_RADIUS_M + 1e-6);
  });

  it('lets a walker slide ALONG it rather than stopping dead', () => {
    // Walking north-east into the west wall: the northward part survives.
    const at = resolveCollisions([-1, 10], [1, 12], [BLOCK], EYE_HEIGHT_M);
    expect(at[1]).toBeGreaterThan(11.5);
    expect(at[0]).toBeLessThan(0);
  });

  it('pushes a walker who is already inside back out', () => {
    const at = resolveCollisions([20, 15], [20, 15], [BLOCK], EYE_HEIGHT_M);
    expect(insideAnyBuilding([BLOCK], at[0], at[1], EYE_HEIGHT_M)).toBe(false);
  });

  it('is not there at all above the roof', () => {
    const at = resolveCollisions([-5, 15], [5, 15], [BLOCK], 80);
    expect(at[0]).toBeCloseTo(5, 6);
  });

  it('is not there below an arcade', () => {
    const arcade: Obstacle = { ...BLOCK, baseM: 6 };
    expect(resolveCollisions([-5, 15], [5, 15], [arcade], EYE_HEIGHT_M)[0]).toBeCloseTo(5, 6);
    // But it is there for someone on the sixth floor.
    expect(resolveCollisions([-5, 15], [5, 15], [arcade], 10)[0]).toBeLessThan(0);
  });

  it('leaves a walker in the open completely alone', () => {
    const at = resolveCollisions([-50, 15], [-46, 15], [BLOCK], EYE_HEIGHT_M);
    expect(at).toEqual([-46, 15]);
  });
});

describe('a walk', () => {
  it('goes the way the walker is facing', () => {
    // Bearing 90 is east.
    const next = stepWalk(START, { ...NO_INPUT, forward: 1 }, 1, []);
    expect(next.x).toBeCloseTo(START.x + WALK_SPEED_MS * 0.1, 4);
    expect(next.y).toBeCloseTo(START.y, 6);
  });

  it('strafes ninety degrees clockwise of that', () => {
    const next = stepWalk(START, { ...NO_INPUT, strafe: 1 }, 1, []);
    // Facing east, right is south.
    expect(next.y).toBeLessThan(START.y);
    expect(next.x).toBeCloseTo(START.x, 4);
  });

  it('moves faster when running, and by exactly the ratio advertised', () => {
    const walk = stepWalk(START, { ...NO_INPUT, forward: 1 }, 0.1, []);
    const run = stepWalk(START, { ...NO_INPUT, forward: 1, running: true }, 0.1, []);
    const walked = Math.abs(walk.x - START.x);
    const ran = Math.abs(run.x - START.x);
    expect(ran / walked).toBeCloseTo(RUN_SPEED_MS / WALK_SPEED_MS, 5);
  });

  it('clamps a huge time step, so a backgrounded tab does not teleport', () => {
    // A tab that has been hidden hands back a delta of several seconds.
    const next = stepWalk(START, { ...NO_INPUT, forward: 1 }, 30, []);
    expect(Math.abs(next.x - START.x)).toBeLessThan(RUN_SPEED_MS);
  });

  it('clamps pitch short of straight up and straight down', () => {
    let s = START;
    for (let i = 0; i < 200; i++) s = stepWalk(s, { ...NO_INPUT, look: 90 }, 0.1, []);
    expect(s.pitch).toBeLessThanOrEqual(88);
    for (let i = 0; i < 400; i++) s = stepWalk(s, { ...NO_INPUT, look: -90 }, 0.1, []);
    expect(s.pitch).toBeGreaterThanOrEqual(2);
  });

  it('never ends a step inside a building, from any direction', () => {
    // The claim, checked exhaustively: march a walker at the block from every
    // bearing, from far enough out to reach it, and assert they never get in.
    for (let deg = 0; deg < 360; deg += 3) {
      const rad = (deg * Math.PI) / 180;
      let s: WalkState = {
        x: 20 + Math.sin(rad) * 60,
        y: 15 + Math.cos(rad) * 60,
        z: EYE_HEIGHT_M,
        // Facing back at the middle of the block.
        bearing: deg + 180,
        pitch: 84,
      };
      for (let i = 0; i < 120; i++) {
        s = stepWalk(s, { ...NO_INPUT, forward: 1, running: true }, 0.1, [BLOCK]);
        expect(insideAnyBuilding([BLOCK], s.x, s.y, s.z)).toBe(false);
      }
    }
  });

  it('does not squeeze through a gap narrower than the walker', () => {
    // The alley is 3 m wide, so a walker fits — but a walker aimed at the
    // solid west face of the second block must not pop out the other side.
    let s: WalkState = { x: -20, y: 15, z: EYE_HEIGHT_M, bearing: 90, pitch: 84 };
    for (let i = 0; i < 200; i++) {
      s = stepWalk(s, { ...NO_INPUT, forward: 1, running: true }, 0.1, ALLEY);
    }
    expect(s.x).toBeLessThan(0);
  });

  it('can walk DOWN the alley, which is the point of a city', () => {
    // A walk that cannot pass between two buildings is a walk in a car park.
    let s: WalkState = { x: 41.5, y: -20, z: EYE_HEIGHT_M, bearing: 0, pitch: 84 };
    for (let i = 0; i < 200; i++) {
      s = stepWalk(s, { ...NO_INPUT, forward: 1 }, 0.1, ALLEY);
      expect(insideAnyBuilding(ALLEY, s.x, s.y, s.z)).toBe(false);
    }
    expect(s.y).toBeGreaterThan(30);
  });

  it('stays put rather than teleporting when wedged in a corner', () => {
    // Two walls meeting: the pushes fight, and staying put is the honest
    // answer. What must never happen is being flung across the block.
    const corner: Obstacle[] = [
      { ring: [[0, 0], [40, 0], [40, 30], [0, 30]], topM: 60 },
      { ring: [[-40, 30], [40, 30], [40, 70], [-40, 70]], topM: 60 },
    ];
    let s: WalkState = { x: -0.4, y: 29.6, z: EYE_HEIGHT_M, bearing: 45, pitch: 84 };
    for (let i = 0; i < 60; i++) {
      const before = s;
      s = stepWalk(s, { ...NO_INPUT, forward: 1, running: true }, 0.1, corner);
      expect(Math.hypot(s.x - before.x, s.y - before.y)).toBeLessThan(RUN_SPEED_MS);
      expect(insideAnyBuilding(corner, s.x, s.y, s.z)).toBe(false);
    }
  });
});

describe('arriving on the pavement', () => {
  it('moves a walker dropped inside a tower out of it', () => {
    const at = groundEntry([20, 15], [BLOCK]);
    expect(insideAnyBuilding([BLOCK], at[0], at[1], EYE_HEIGHT_M)).toBe(false);
  });

  it('leaves a walker dropped in the street where they are', () => {
    expect(groundEntry([-20, 15], [BLOCK])).toEqual([-20, 15]);
  });

  it('gets out of a dense block, not merely out of one building', () => {
    // Dropped in the gap between two buildings that are closer together than
    // the entry clearance: one push moves into the other, so it takes two.
    const tight: Obstacle[] = [
      { ring: [[0, 0], [40, 0], [40, 30], [0, 30]], topM: 60 },
      { ring: [[40.8, 0], [80, 0], [80, 30], [40.8, 30]], topM: 60 },
    ];
    const at = groundEntry([40.4, 15], tight);
    expect(insideAnyBuilding(tight, at[0], at[1], EYE_HEIGHT_M)).toBe(false);
  });

  it('is a place a walk can then legally start from', () => {
    const at = groundEntry([20, 15], [BLOCK]);
    const s = stepWalk(
      { x: at[0], y: at[1], z: EYE_HEIGHT_M, bearing: 0, pitch: 84 },
      { ...NO_INPUT, forward: 1 },
      0.1,
      [BLOCK],
    );
    expect(insideAnyBuilding([BLOCK], s.x, s.y, s.z)).toBe(false);
  });
});
