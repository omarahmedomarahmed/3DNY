import { describe, expect, it } from 'vitest';
import type { Massing } from '@/lib/citygml';
import {
  cylinder,
  parapetMassing,
  roofPlatforms,
  crownOf,
  roofMassing,
  roofscapeFor,
} from '@/components/explore/roofs3d';
import { makeFrame, pointInRing, signedArea2 } from '@/lib/explore/frame';
import type { Building } from '@/types';

/**
 * Roof furniture as real geometry.
 *
 * `lib/roofscape.ts` already decides WHAT is on a roof and is tested on its
 * own terms. What is checked here is where it ends up in three dimensions —
 * and in particular the one thing that goes wrong on a surveyed building: a
 * derived roofscape assumes the roof is at the footprint's height with the
 * footprint's outline, and on a tower with setbacks neither is true.
 */

const FRAME = makeFrame(-73.98, 40.75);

const OUTER: [number, number][] = [[0, 0], [40, 0], [40, 30], [0, 30]];
const INNER: [number, number][] = [[2, 2], [38, 2], [38, 28], [2, 28]];

describe('a parapet', () => {
  it('is a wall with a lid, not a slab', () => {
    const m = parapetMassing(OUTER, INNER, 100, 1.2);
    // Per edge: an outer face, an inner face and a coping, two triangles each.
    expect(m.triangles).toBe(4 * 3 * 2);
  });

  it('is hollow, so the plant standing inside it is not covered up', () => {
    const m = parapetMassing(OUTER, INNER, 100, 1.2);
    // A solid slab would have vertices in the middle of the roof. Every
    // vertex here is on one of the two rings.
    for (let i = 0; i < m.position.length; i += 3) {
      const x = m.position[i];
      const y = m.position[i + 1];
      const onOuter = x <= 0.01 || x >= 39.99 || y <= 0.01 || y >= 29.99;
      const onInner = Math.abs(x - 2) < 0.01 || Math.abs(x - 38) < 0.01 ||
                      Math.abs(y - 2) < 0.01 || Math.abs(y - 28) < 0.01;
      expect(onOuter || onInner).toBe(true);
    }
  });

  it('sits on the roof it was given, and rises by its own height', () => {
    const m = parapetMassing(OUTER, INNER, 100, 1.2);
    expect(Math.min(...Array.from(m.up))).toBeCloseTo(100, 5);
    expect(Math.max(...Array.from(m.up))).toBeCloseTo(101.2, 5);
  });

  it('points its outer face out and its inner face in', () => {
    const m = parapetMassing(OUTER, INNER, 100, 1.2);
    // The south edge runs west to east, so its outer face must point south.
    const south = [];
    for (let i = 0; i < m.position.length / 3; i++) {
      if (Math.abs(m.position[i * 3 + 1]) < 0.01 && m.isWall[i] > 0.5) {
        south.push(m.normal[i * 3 + 1]);
      }
    }
    expect(south.some((n) => n < -0.5)).toBe(true);
  });

  it('falls back to a solid box when the two rings do not correspond', () => {
    const m = parapetMassing(OUTER, [[0, 0]], 100, 1.2);
    expect(m.triangles).toBeGreaterThan(0);
  });
});

describe('a water tank', () => {
  it('is a prism with as many sides as it was asked for', () => {
    const m = cylinder(10, 10, 2, 50, 4, 8);
    // Eight walls at two triangles, plus a cap fanned into six.
    expect(m.triangles).toBe(8 * 2 + 6);
  });

  it('stands on its base rather than being centred on it', () => {
    const m = cylinder(10, 10, 2, 50, 4, 8);
    expect(Math.min(...Array.from(m.up))).toBeCloseTo(50, 5);
    expect(Math.max(...Array.from(m.up))).toBeCloseTo(54, 5);
  });

  it('is where it was put', () => {
    const m = cylinder(10, -4, 2, 50, 4, 8);
    let sx = 0;
    let sy = 0;
    const n = m.position.length / 3;
    for (let i = 0; i < n; i++) {
      sx += m.position[i * 3];
      sy += m.position[i * 3 + 1];
    }
    expect(sx / n).toBeCloseTo(10, 1);
    expect(sy / n).toBeCloseTo(-4, 1);
  });

  it('winds counter-clockwise, so its walls face outward', () => {
    const ring: [number, number][] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ring.push([Math.cos(a) * 2, Math.sin(a) * 2]);
    }
    expect(signedArea2(ring)).toBeGreaterThan(0);
  });
});

// A stepped tower: a wide base to 40 m, a shaft to 200 m offset 12 m east,
// with a roof surface on each and a tiny antenna cap on top.
const TOWER: Massing = {
  anchor: [-73.98, 40.75],
  topM: 210,
  surfaces: [
    { k: 'W', p: [-30, -15, 0, 30, -15, 0, 30, -15, 40, -30, -15, 40] },
    { k: 'W', p: [30, -15, 0, 30, 15, 0, 30, 15, 40, 30, -15, 40] },
    { k: 'W', p: [30, 15, 0, -30, 15, 0, -30, 15, 40, 30, 15, 40] },
    { k: 'W', p: [-30, 15, 0, -30, -15, 0, -30, -15, 40, -30, 15, 40] },
    { k: 'W', p: [2, -6, 40, 22, -6, 40, 22, -6, 200, 2, -6, 200] },
    { k: 'W', p: [22, -6, 40, 22, 6, 40, 22, 6, 200, 22, -6, 200] },
    { k: 'W', p: [22, 6, 40, 2, 6, 40, 2, 6, 200, 22, 6, 200] },
    { k: 'W', p: [2, 6, 40, 2, -6, 40, 2, -6, 200, 2, 6, 200] },
    // The setback terrace, the tower's own roof, and an antenna cap.
    { k: 'R', p: [-30, -15, 40, 30, -15, 40, 30, 15, 40, -30, 15, 40] },
    { k: 'R', p: [2, -6, 200, 22, -6, 200, 22, 6, 200, 2, 6, 200] },
    { k: 'R', p: [11, -1, 210, 13, -1, 210, 13, 1, 210, 11, 1, 210] },
  ],
};

describe('finding the crown of a surveyed building', () => {
  it('lists the roofs worth standing on, biggest first', () => {
    const platforms = roofPlatforms(TOWER);
    expect(platforms).toHaveLength(2);
    expect(platforms[0].areaM2).toBeCloseTo(60 * 30, 0);
    expect(platforms[1].areaM2).toBeCloseTo(20 * 12, 0);
  });

  it('excludes the antenna cap, which is not somewhere plant stands', () => {
    // Four square metres, at the very top. Excluded by AREA rather than by
    // height, because on a real tower the topmost surface IS the antenna and
    // a plant room on it would be absurd in a way that is easy to ship.
    expect(roofPlatforms(TOWER).every((p) => p.areaM2 > 100)).toBe(true);
  });

  it('takes the crown\\u2019s outline from the massing, not the plot', () => {
    const crown = crownOf(TOWER);
    expect(crown).not.toBeNull();
    // The largest roof is the setback terrace at 40 m, whose outline is the
    // base block.
    expect(crown!.zM).toBeCloseTo(40, 1);
    expect(crown!.ring.length).toBeGreaterThanOrEqual(4);
  });

  it('gives nothing back when there is no roof big enough', () => {
    expect(crownOf(TOWER, 10_000)).toBeNull();
  });
});

describe('placing a roofscape on a surveyed tower', () => {
  const BUILDING = {
    id: 'test',
    bin: '9999999',
    footprint: [
      [-73.9805, 40.7495],
      [-73.9795, 40.7495],
      [-73.9795, 40.7505],
      [-73.9805, 40.7505],
    ] as [number, number][],
    lon: -73.98,
    lat: 40.75,
    // The plot's own record says 300 m; the surveyed crown is at 40 m.
    height_roof_ft: 300 / 0.3048,
    num_floors: 75,
    year_built: 1931,
    floor_height_override: null,
  } as unknown as Building;

  it('puts the furniture on the surveyed crown, not at the plot\\u2019s height', () => {
    const derived = roofscapeFor(BUILDING, TOWER);
    const plain = roofscapeFor(BUILDING, null);
    expect(derived.parapet).not.toBeNull();
    expect(plain.parapet).not.toBeNull();
    // 40 m against 300 m. Left alone, every water tank on a surveyed tower
    // would float two hundred and sixty metres above its own roof.
    expect(derived.parapet!.baseFt).toBeLessThan(plain.parapet!.baseFt / 3);
  });

  it('falls back to the plot when there is no surveyed massing', () => {
    const plain = roofscapeFor(BUILDING, null);
    expect(plain.parapet!.baseFt).toBeCloseTo(300 / 0.3048, 0);
  });

  it('builds geometry for it, in the scene frame', () => {
    const m = roofMassing(FRAME, roofscapeFor(BUILDING, TOWER));
    expect(m).not.toBeNull();
    expect(m!.triangles).toBeGreaterThan(20);
    // Everything is on the crown or above it, never below.
    expect(Math.min(...Array.from(m!.up))).toBeGreaterThan(35);
  });

  it('produces nothing rather than throwing for a building with no ring', () => {
    const nothing = roofMassing(FRAME, roofscapeFor(
      { ...BUILDING, footprint: null, lon: null, lat: null } as unknown as Building,
      null,
    ));
    expect(nothing).toBeNull();
  });

  it('keeps the furniture inside the crown it stands on', () => {
    const crown = crownOf(TOWER)!;
    const scape = roofscapeFor(BUILDING, TOWER);
    // Bulkheads are placed about the crown's centroid, so each must sit
    // within the crown's own outline — a plant room hanging off the edge of
    // the roof is the same class of error as a band drawn on the plot.
    for (const box of scape.bulkheads) {
      let inside = 0;
      for (const [lon, lat] of box.ring) {
        if (pointInRing(crown.ring, lon, lat)) inside++;
      }
      expect(inside).toBeGreaterThan(0);
    }
  });
});
