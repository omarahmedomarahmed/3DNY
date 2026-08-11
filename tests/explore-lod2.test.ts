import { beforeEach, describe, expect, it } from 'vitest';
import type { Massing } from '@/lib/citygml';
import {
  massingToArrays,
  heightProfile,
  radiusFromProfile,
  ringReachM,
  sectionAt,
  convexHull,
} from '@/lib/explore/lod2';
import {
  ingest,
  lod2For,
  lod2Stats,
  resetLod2,
  surveyedSectionAt,
} from '@/lib/explore/lod2-registry';
import { bandRingAt, insetForBuilding } from '@/lib/explore/profile';
import { makeFrame } from '@/lib/explore/frame';
import { pointInRing } from '@/lib/explore/frame';
import type { Building } from '@/types';

/**
 * NYC's surveyed massing, and the thing §5 says it is really for.
 *
 * The silhouette is the visible half of the argument. The half that matters is
 * that a Goldenrod band lands on the tower rather than on the base it rises
 * out of — so most of what is checked here is where a collar ends up.
 *
 * The fixture is a tower in the shape the plan describes: a wide base block
 * with a narrower shaft standing on it, deliberately OFF-CENTRE in its plot,
 * because a centred shaft is the one case a naive scalar inset happens to get
 * right.
 */

const FRAME = makeFrame(-73.98, 40.75);

/** A vertical wall quad, given its two horizontal corners and its z span. */
function wall(
  ax: number, ay: number,
  bx: number, by: number,
  z0: number, z1: number,
): { k: 'W'; p: number[] } {
  return { k: 'W', p: [ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z1] };
}

/** A rectangular prism's four walls, from a centre, half-extents and z span. */
function box(
  cx: number, cy: number,
  hx: number, hy: number,
  z0: number, z1: number,
) {
  const c: [number, number][] = [
    [cx - hx, cy - hy],
    [cx + hx, cy - hy],
    [cx + hx, cy + hy],
    [cx - hx, cy + hy],
  ];
  return c.map((_, i) => {
    const a = c[i];
    const b = c[(i + 1) % 4];
    return wall(a[0], a[1], b[0], b[1], z0, z1);
  });
}

/**
 * A wedding-cake tower: 60 × 30 m base to 40 m, then a 20 × 12 m shaft to
 * 200 m, sitting 12 m east of the plot's centre.
 */
const TOWER: Massing = {
  anchor: [-73.98, 40.75],
  topM: 200,
  surfaces: [
    ...box(0, 0, 30, 15, 0, 40),
    ...box(12, 0, 10, 6, 40, 200),
    { k: 'R', p: [-30, -15, 40, 30, -15, 40, 30, 15, 40, -30, 15, 40] },
    { k: 'G', p: [-30, -15, 0, 30, -15, 0, 30, 15, 0, -30, 15, 0] },
  ],
};

/** The plot, in lon/lat, matching the base block exactly. */
const FOOTPRINT: [number, number][] = (() => {
  const mPerLon = 111_320 * Math.cos((40.75 * Math.PI) / 180);
  const toLL = (x: number, y: number): [number, number] => [
    -73.98 + x / mPerLon,
    40.75 + y / 110_574,
  ];
  return [toLL(-30, -15), toLL(30, -15), toLL(30, 15), toLL(-30, 15)];
})();

const BUILDING = {
  id: 'test',
  bin: '9999999',
  footprint: FOOTPRINT,
  lon: -73.98,
  lat: 40.75,
  height_roof_ft: 200 / 0.3048,
  num_floors: 50,
  year_built: 1931,
  floor_height_override: null,
} as unknown as Building;

describe('turning surveyed surfaces into geometry', () => {
  it('draws walls and roofs and drops the ground surface', () => {
    const arrays = massingToArrays(FRAME, TOWER);
    // Eight wall quads and one roof quad, two triangles each. The ground
    // surface is under everything and can never be seen.
    expect(arrays.triangles).toBe(9 * 2);
  });

  it('marks walls as walls and roofs as roofs, for the facade shader', () => {
    const arrays = massingToArrays(FRAME, TOWER);
    const walls = Array.from(arrays.isWall).filter((v) => v > 0.5).length;
    const roofs = Array.from(arrays.isWall).filter((v) => v < 0.5).length;
    expect(walls).toBe(8 * 4);
    expect(roofs).toBe(4);
  });

  it('measures `up` from the building own ground, not from the datum', () => {
    const arrays = massingToArrays(FRAME, TOWER);
    expect(Math.min(...Array.from(arrays.up))).toBeCloseTo(0, 4);
    expect(Math.max(...Array.from(arrays.up))).toBeCloseTo(200, 4);
  });

  it('carries each wall own height, so a parapet is not a tower', () => {
    const arrays = massingToArrays(FRAME, TOWER);
    const heights = new Set(Array.from(arrays.wall).map((v) => Math.round(v)));
    expect(heights.has(40)).toBe(true);
    expect(heights.has(160)).toBe(true);
  });

  it('places the building where its anchor says, not at the frame origin', () => {
    const offset = makeFrame(-73.99, 40.74);
    const here = massingToArrays(FRAME, TOWER);
    const there = massingToArrays(offset, TOWER);
    // A frame origin a kilometre away moves every vertex by a kilometre.
    expect(Math.abs(there.position[0] - here.position[0])).toBeGreaterThan(500);
  });

  it('can leave the roofs out, for a lower level of detail', () => {
    expect(massingToArrays(FRAME, TOWER, { includeRoofs: false }).triangles).toBe(8 * 2);
  });
});

describe('the height profile', () => {
  it('measures a wall over its whole span, not only at its vertices', () => {
    const profile = heightProfile(TOWER);
    expect(profile).not.toBeNull();
    // Half way up the shaft there are no wall VERTICES at all — the shaft is
    // one tall quad. Bucketing vertices made every band up here inherit the
    // base block's width, which is the bug that put bands out in mid-air.
    const midShaft = radiusFromProfile(profile!, 120);
    const base = radiusFromProfile(profile!, 5);
    expect(midShaft).toBeLessThan(base * 0.8);
    /**
     * Only 0.8, for a shaft that is a third of the base's area — and that
     * slack is the reason this scalar is a fallback rather than the answer.
     *
     * Reach is measured from the building's anchor, so an off-centre shaft's
     * far corner stays a long way out even though the shaft itself is small.
     * A single number cannot express "narrower, and over there". The section
     * test below is what actually pins a band to the tower; this one only has
     * to hold for the buildings the survey never saw.
     */
  });

  it('reports reach in metres, so it can be compared with a footprint', () => {
    const profile = heightProfile(TOWER)!;
    // The base block's corners are 33.5 m from the anchor.
    expect(radiusFromProfile(profile, 5)).toBeGreaterThan(25);
    expect(radiusFromProfile(profile, 5)).toBeLessThan(36);
  });

  it('keeps the surveyed top, mast included', () => {
    expect(heightProfile(TOWER)!.topM).toBeCloseTo(200, 1);
  });

  it('gives nothing back for a building with no walls', () => {
    expect(heightProfile({ anchor: [0, 0], topM: 0, surfaces: [] })).toBeNull();
  });

  it('measures a footprint ring the same way it measures the model', () => {
    // The plot's corners are 33.5 m from its centre; the 90th percentile of
    // four equal corners is that same number.
    expect(ringReachM(FOOTPRINT)).toBeGreaterThan(30);
    expect(ringReachM(FOOTPRINT)).toBeLessThan(36);
  });
});

describe('slicing the massing — what a band is actually drawn on', () => {
  it('returns the base block low down', () => {
    const section = sectionAt(TOWER, 20);
    expect(section.length).toBeGreaterThanOrEqual(4);
    const xs = section.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-30, 1);
    expect(Math.max(...xs)).toBeCloseTo(30, 1);
  });

  it('returns the shaft high up — and the shaft is where it really is', () => {
    const section = sectionAt(TOWER, 120);
    const xs = section.map((p) => p[0]);
    const ys = section.map((p) => p[1]);
    // 20 x 12 m, centred 12 m east. A scalar inset about the plot's centre
    // cannot produce this: it would be centred on zero and the wrong shape.
    expect(Math.min(...xs)).toBeCloseTo(2, 1);
    expect(Math.max(...xs)).toBeCloseTo(22, 1);
    expect(Math.min(...ys)).toBeCloseTo(-6, 1);
    expect(Math.max(...ys)).toBeCloseTo(6, 1);
  });

  it('returns nothing above the top of the building', () => {
    expect(sectionAt(TOWER, 500)).toHaveLength(0);
  });

  describe('the convex hull it is built with', () => {
    it('wraps a square', () => {
      const hull = convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]);
      expect(hull).toHaveLength(4);
    });

    it('drops interior points', () => {
      const hull = convexHull([[0, 0], [4, 0], [4, 4], [0, 4], [2, 2], [1, 3]]);
      expect(hull).toHaveLength(4);
    });

    it('hands back what it was given when there is no hull to find', () => {
      expect(convexHull([[0, 0], [1, 1]])).toHaveLength(2);
      expect(convexHull([[0, 0], [1, 1], [2, 2]])).toHaveLength(3);
    });

    it('winds counter-clockwise, which the massing builder assumes', () => {
      const hull = convexHull([[0, 0], [4, 0], [4, 4], [0, 4]]);
      let area = 0;
      for (let i = 0; i < hull.length; i++) {
        const [ax, ay] = hull[i];
        const [bx, by] = hull[(i + 1) % hull.length];
        area += ax * by - bx * ay;
      }
      expect(area).toBeGreaterThan(0);
    });
  });
});

describe('the registry, and where a band ends up', () => {
  beforeEach(() => {
    resetLod2();
  });

  const asset = {
    version: 1,
    source: 'test',
    sourceUrl: '',
    surveyYear: 2014,
    buildings: { '9999999': TOWER },
    missing: [{ bin: '8888888', address: 'Built after the survey' }],
  };

  it('reports what it holds', () => {
    ingest(asset);
    expect(lod2Stats()).toEqual({ matched: 1, missing: 1, loaded: true });
    expect(lod2For('9999999')).not.toBeNull();
    expect(lod2For('8888888')).toBeNull();
    expect(lod2For(null)).toBeNull();
  });

  it('caches a slice rather than walking every wall again', () => {
    ingest(asset);
    const first = surveyedSectionAt('9999999', 120);
    const second = surveyedSectionAt('9999999', 120);
    expect(first).not.toBeNull();
    // Identity, not equality: the cache is what keeps a filter keystroke from
    // re-slicing every wall of every tower on screen.
    expect(second).toBe(first);
  });

  it('puts a band on the SHAFT high up, not on the plot', () => {
    ingest(asset);
    // Floor 32 of a 50-floor, 200 m building is about 124 m up: on the shaft.
    const floorFt = (200 / 0.3048) / 50;
    const ring = bandRingAt(BUILDING, 31 * floorFt, 1.035);
    expect(ring).not.toBeNull();

    // The plot's centre must be OUTSIDE the band, because the shaft is not
    // over it. This is the assertion §5 is really about: a collar drawn on
    // the footprint would contain this point, and would be hanging in the air.
    expect(pointInRing(ring!, -73.98, 40.75)).toBe(false);

    // And the shaft's own centre must be inside it.
    const mPerLon = 111_320 * Math.cos((40.75 * Math.PI) / 180);
    expect(pointInRing(ring!, -73.98 + 12 / mPerLon, 40.75)).toBe(true);
  });

  it('puts a band on the BASE low down, where the plot is the answer', () => {
    ingest(asset);
    const floorFt = (200 / 0.3048) / 50;
    const ring = bandRingAt(BUILDING, 4 * floorFt, 1.035);
    expect(pointInRing(ring!, -73.98, 40.75)).toBe(true);
  });

  it('falls back to the footprint for a building the survey predates', () => {
    ingest({ ...asset, buildings: {} });
    const ring = bandRingAt(BUILDING, 100, 1.035);
    expect(ring).not.toBeNull();
    // No surveyed massing means no claim about setbacks: the collar is the
    // plot, which on a plain prism is exactly right.
    expect(pointInRing(ring!, -73.98, 40.75)).toBe(true);
  });

  it('leaves the fallback profile alone when nothing is loaded', () => {
    // A pre-war tower still gets its stepped guess, and it still narrows.
    expect(insetForBuilding(BUILDING, 600)).toBeLessThan(insetForBuilding(BUILDING, 10));
  });

  it('never widens a band beyond the plot', () => {
    ingest(asset);
    for (let ft = 0; ft < 650; ft += 25) {
      expect(insetForBuilding(BUILDING, ft)).toBeLessThanOrEqual(1);
    }
  });
});
