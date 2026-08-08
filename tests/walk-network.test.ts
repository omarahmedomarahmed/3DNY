import { describe, expect, it } from 'vitest';
import {
  buildWalkGraph,
  nearestNode,
  routeOnStreets,
  walkGraphFor,
} from '../src/lib/walk-network';
import { metersBetween } from '../src/lib/transit';
import type { RoadSegment } from '../src/lib/streetscape';

/**
 * Walking routes computed on the streets that are actually drawn.
 *
 * The previous routes were a synthetic L using one hard-coded bearing for the
 * whole island. That was invisible while the map had no street geometry; once
 * real centrelines were drawn underneath, the route visibly set off at its own
 * angle and cut across blocks.
 */

const LAT = 40.75;
const M_PER_LAT = 111_320;
const M_PER_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);
const east = (m: number) => m / M_PER_LON;
const north = (m: number) => m / M_PER_LAT;

function road(p: [number, number][], t: 0 | 1 | 2 | 3 = 2): RoadSegment {
  return { p, w: 34, t, n: 'TEST' };
}

/**
 * A small square grid: two east-west streets and two north-south avenues,
 * 200m apart, noded where they cross — the shape of a Manhattan block.
 */
function grid(): RoadSegment[] {
  const x0 = -73.98;
  const x1 = -73.98 + east(200);
  const y0 = LAT;
  const y1 = LAT + north(200);
  return [
    // East-west, each split at the crossing so the graph is noded.
    road([
      [x0, y0],
      [x1, y0],
    ]),
    road([
      [x0, y1],
      [x1, y1],
    ]),
    // North-south.
    road([
      [x0, y0],
      [x0, y1],
    ]),
    road([
      [x1, y0],
      [x1, y1],
    ]),
  ];
}

describe('buildWalkGraph', () => {
  it('joins segments that share an endpoint into one network', () => {
    const g = buildWalkGraph(grid());
    // Four corners.
    expect(g.nodes.size).toBe(4);
    // Every corner reaches two neighbours.
    for (const [, neighbours] of g.edges) expect(neighbours.length).toBe(2);
  });

  it('is undirected, because one-way streets do not apply to walking', () => {
    const g = buildWalkGraph([
      road([
        [-73.98, LAT],
        [-73.98 + east(100), LAT],
      ]),
    ]);
    const keys = [...g.nodes.keys()];
    expect(g.edges.get(keys[0])?.length).toBe(1);
    expect(g.edges.get(keys[1])?.length).toBe(1);
  });

  it('leaves highways, bridges and ramps out', () => {
    // Routing a pedestrian down the FDR Drive is confidently wrong, and the
    // walk time printed beside it would be a lie.
    const g = buildWalkGraph([
      road(
        [
          [-73.98, LAT],
          [-73.98 + east(100), LAT],
        ],
        0,
      ),
    ]);
    expect(g.nodes.size).toBe(0);
  });

  it('ignores zero-length segments', () => {
    const g = buildWalkGraph([
      road([
        [-73.98, LAT],
        [-73.98, LAT],
      ]),
    ]);
    expect(g.edges.size).toBe(0);
  });
});

describe('nearestNode', () => {
  it('snaps a point beside a street to that street', () => {
    const g = buildWalkGraph(grid());
    const key = nearestNode(g, [-73.98 + east(4), LAT + north(4)]);
    expect(key).not.toBeNull();
    expect(metersBetween(g.nodes.get(key!)!, [-73.98, LAT])).toBeLessThan(10);
  });

  it('refuses a point nowhere near a street rather than guessing', () => {
    const g = buildWalkGraph(grid());
    expect(nearestNode(g, [-73.9, LAT])).toBeNull();
  });

  it('handles an empty network', () => {
    expect(nearestNode(buildWalkGraph([]), [-73.98, LAT])).toBeNull();
  });
});

describe('routeOnStreets', () => {
  it('goes around the block rather than across it', () => {
    const g = buildWalkGraph(grid());
    const from: [number, number] = [-73.98, LAT];
    const to: [number, number] = [-73.98 + east(200), LAT + north(200)];
    const path = routeOnStreets(g, from, to)!;
    expect(path).not.toBeNull();

    // The diagonal is ~283m; two legs of the grid are 400m. A route that came
    // back near 283m would be cutting through the block.
    let length = 0;
    for (let i = 1; i < path.length; i++) length += metersBetween(path[i - 1], path[i]);
    expect(length).toBeGreaterThan(380);
    expect(length).toBeLessThan(420);
  });

  it('starts at the origin and ends at the destination', () => {
    const g = buildWalkGraph(grid());
    const from: [number, number] = [-73.98 + east(3), LAT + north(3)];
    const to: [number, number] = [-73.98 + east(197), LAT + north(3)];
    const path = routeOnStreets(g, from, to)!;
    // Without the stubs from doorway to kerb the line starts in mid-air.
    expect(path[0]).toEqual(from);
    expect(path[path.length - 1]).toEqual(to);
  });

  it('takes the shorter way round when the block is not square', () => {
    // Wide east-west, short north-south: going the long way must not win.
    const x0 = -73.98;
    const x1 = -73.98 + east(600);
    const y0 = LAT;
    const y1 = LAT + north(80);
    const g = buildWalkGraph([
      road([
        [x0, y0],
        [x1, y0],
      ]),
      road([
        [x0, y1],
        [x1, y1],
      ]),
      road([
        [x0, y0],
        [x0, y1],
      ]),
      road([
        [x1, y0],
        [x1, y1],
      ]),
    ]);
    const path = routeOnStreets(g, [x0, y0], [x0, y1])!;
    let length = 0;
    for (let i = 1; i < path.length; i++) length += metersBetween(path[i - 1], path[i]);
    // Straight up the short side is 80m; round the long way is 1280m.
    expect(length).toBeLessThan(120);
  });

  it('returns null when an end is nowhere near a street, so the caller decides', () => {
    const g = buildWalkGraph(grid());
    expect(routeOnStreets(g, [-73.98, LAT], [-73.5, LAT])).toBeNull();
  });

  it('returns null on a disconnected network rather than an invented line', () => {
    const g = buildWalkGraph([
      road([
        [-73.98, LAT],
        [-73.98 + east(50), LAT],
      ]),
      road([
        [-73.9795, LAT + north(300)],
        [-73.9795 + east(50), LAT + north(300)],
      ]),
    ]);
    expect(routeOnStreets(g, [-73.98, LAT], [-73.9795, LAT + north(300)])).toBeNull();
  });
});

describe('walkGraphFor', () => {
  it('reuses one graph per road payload', () => {
    // The layer set rebuilds on every hover; rebuilding the graph each time
    // would be the most expensive thing on the frame.
    const roads = grid();
    expect(walkGraphFor(roads)).toBe(walkGraphFor(roads));
  });
});
