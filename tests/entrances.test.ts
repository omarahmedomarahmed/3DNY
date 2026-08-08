import { describe, expect, it } from 'vitest';
import {
  buildRoadIndex,
  entranceKind,
  nearestRoadAngle,
  pointToSegmentMeters,
  type RoadSegment,
} from '../src/lib/streetscape';
import { orientedRect } from '../src/components/map/ground';

const LAT = 40.75;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);

const east = (m: number) => m / M_PER_DEG_LON;
const north = (m: number) => m / M_PER_DEG_LAT;

describe('entranceKind', () => {
  it('recognises the MTA vocabulary', () => {
    expect(entranceKind('Stair')).toBe(0);
    expect(entranceKind('Elevator')).toBe(1);
    expect(entranceKind('Escalator')).toBe(2);
    expect(entranceKind('Door')).toBe(3);
    expect(entranceKind('Easement')).toBe(3);
    expect(entranceKind('Ramp')).toBe(3);
  });

  it('is case and whitespace tolerant', () => {
    expect(entranceKind('  STAIR ')).toBe(0);
    expect(entranceKind('elevator')).toBe(1);
  });

  it('falls back rather than throwing on an unseen type', () => {
    expect(entranceKind('Teleporter')).toBe(3);
    expect(entranceKind('')).toBe(3);
  });
});

describe('pointToSegmentMeters', () => {
  const a: [number, number] = [-73.98, LAT];
  const b: [number, number] = [-73.98 + east(100), LAT];

  it('measures the perpendicular distance to the segment', () => {
    const p: [number, number] = [-73.98 + east(50), LAT + north(20)];
    expect(pointToSegmentMeters(p, a, b)).toBeCloseTo(20, 0);
  });

  it('is zero on the segment', () => {
    expect(pointToSegmentMeters([-73.98 + east(50), LAT], a, b)).toBeCloseTo(0, 3);
  });

  it('clamps beyond the ends rather than measuring to the infinite line', () => {
    // A point 500m past the end is 500m away, not 0m — otherwise an entrance
    // gets oriented by a street whose line passes near but which is nowhere
    // near it.
    const p: [number, number] = [-73.98 + east(600), LAT];
    expect(pointToSegmentMeters(p, a, b)).toBeCloseTo(500, 0);
  });

  it('handles a degenerate zero-length segment', () => {
    expect(pointToSegmentMeters([-73.98 + east(10), LAT], a, a)).toBeCloseTo(10, 0);
  });
});

function road(line: [number, number][], t: 0 | 1 | 2 | 3 = 2): RoadSegment {
  return { p: line, w: 34, t, n: 'TEST ST' };
}

describe('nearestRoadAngle', () => {
  it('takes its angle from the closest street, not the longest', () => {
    const eastWest = road([
      [-73.98 - east(300), LAT],
      [-73.98 + east(300), LAT],
    ]);
    // A north-south avenue 80m away — closer than nothing, but further than
    // the street the entrance is actually on.
    const northSouth = road([
      [-73.98 + east(80), LAT - north(300)],
      [-73.98 + east(80), LAT + north(300)],
    ]);
    const index = buildRoadIndex([northSouth, eastWest]);
    const angle = nearestRoadAngle([-73.98, LAT + north(6)], index);
    expect(angle).toBeCloseTo(0, 0);
  });

  it('returns null when there is no street nearby, rather than guessing', () => {
    const index = buildRoadIndex([
      road([
        [-73.9, LAT],
        [-73.9 + east(100), LAT],
      ]),
    ]);
    expect(nearestRoadAngle([-73.98, LAT], index)).toBeNull();
  });

  it('handles an empty road set', () => {
    expect(nearestRoadAngle([-73.98, LAT], buildRoadIndex([]))).toBeNull();
  });

  it('finds a street in a neighbouring grid cell, not only its own', () => {
    // Cells are ~110m; a street just over a cell boundary must still be found,
    // which is the whole reason the lookup sweeps a 3x3 neighbourhood.
    const index = buildRoadIndex([
      road([
        [-73.98, LAT + north(60)],
        [-73.98 + east(200), LAT + north(60)],
      ]),
    ]);
    expect(nearestRoadAngle([-73.98 + east(50), LAT], index)).toBeCloseTo(0, 0);
  });
});

describe('orientedRect', () => {
  const center: [number, number] = [-73.98, LAT];

  it('closes the ring', () => {
    const ring = orientedRect(center, 4, 2, 0);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });

  it('is centred on the point it was given', () => {
    const ring = orientedRect(center, 4.6, 2.4, 37);
    const cx = (ring[0][0] + ring[2][0]) / 2;
    const cy = (ring[0][1] + ring[2][1]) / 2;
    expect(cx).toBeCloseTo(center[0], 8);
    expect(cy).toBeCloseTo(center[1], 8);
  });

  it('lies its long side along the street it was given', () => {
    // Along an east-west street, the box must be wider east-west than it is
    // deep north-south — a stair head across the pavement reads as litter.
    const ring = orientedRect(center, 10, 2, 0);
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    const widthM = (Math.max(...lons) - Math.min(...lons)) * M_PER_DEG_LON;
    const depthM = (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG_LAT;
    expect(widthM).toBeCloseTo(10, 0);
    expect(depthM).toBeCloseTo(2, 0);
  });

  it('rotates with the street', () => {
    const ring = orientedRect(center, 10, 2, 90);
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    const widthM = (Math.max(...lons) - Math.min(...lons)) * M_PER_DEG_LON;
    const depthM = (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG_LAT;
    expect(widthM).toBeCloseTo(2, 0);
    expect(depthM).toBeCloseTo(10, 0);
  });

  it('keeps its real proportions at Manhattan latitude', () => {
    // Degrees of longitude are ~76% of degrees of latitude here, so a box
    // built without the correction would come out visibly squashed.
    const ring = orientedRect(center, 8, 8, 0);
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    const widthM = (Math.max(...lons) - Math.min(...lons)) * M_PER_DEG_LON;
    const depthM = (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG_LAT;
    expect(widthM / depthM).toBeCloseTo(1, 2);
  });
});
