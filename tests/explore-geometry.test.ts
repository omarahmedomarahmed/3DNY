import { describe, expect, it } from 'vitest';
import {
  makeFrame,
  toLocal,
  toLngLat,
  openRing,
  toCCW,
  signedArea2,
  pointInRing,
  nearestEdge,
} from '@/lib/explore/frame';
import { triangulate, triangulatePlanar, polygonNormal } from '@/lib/explore/tessellate';
import {
  extrudedMassing,
  steppedMassing,
  fallbackSteps,
  insetRingLocal,
  centroid,
  mergeMassings,
} from '@/lib/explore/massing';
import { sunPosition, sunDirection, julianDays } from '@/lib/explore/sun';
import { cameraOffset, metersPerPixel, viewForEye, MAPLIBRE_FOV } from '@/lib/explore/camera';
import { insetAtHeight, collarOf } from '@/lib/explore/profile';

/**
 * The maths behind Explore mode.
 *
 * Everything here is the sort of thing the project's brief says deserves a
 * test: a projection, a coordinate transform, a collision test, a winding
 * rule. None of it needs a browser, and all of it is the difference between a
 * Goldenrod band landing on the 14th floor and landing near it.
 */

/** Manhattan, near the map's own default centre. */
const MIDTOWN = makeFrame(-73.98, 40.75);

const SQUARE: [number, number][] = [
  [0, 0],
  [40, 0],
  [40, 30],
  [0, 30],
];

describe('the local metric frame', () => {
  it('puts the origin at zero', () => {
    expect(toLocal(MIDTOWN, -73.98, 40.75)).toEqual([0, 0]);
  });

  it('round-trips a point a kilometre away to under a millimetre', () => {
    const [lon, lat] = toLngLat(MIDTOWN, 1000, -1400);
    const [x, y] = toLocal(MIDTOWN, lon, lat);
    expect(x).toBeCloseTo(1000, 6);
    expect(y).toBeCloseTo(-1400, 6);
  });

  it('agrees with a known distance across Manhattan', () => {
    // Empire State Building to One World Trade Center, straight line: 4.6 km.
    const [x, y] = toLocal(MIDTOWN, -74.0134, 40.7127);
    const [ex, ey] = toLocal(MIDTOWN, -73.9857, 40.7484);
    expect(Math.hypot(x - ex, y - ey) / 1000).toBeGreaterThan(4.4);
    expect(Math.hypot(x - ex, y - ey) / 1000).toBeLessThan(4.8);
  });

  it('keeps a square square — a metre east is a metre north', () => {
    const [ex] = toLocal(MIDTOWN, -73.98 + 0.001, 40.75);
    const [, ny] = toLocal(MIDTOWN, -73.98, 40.75 + 0.001);
    // 0.001 degrees of longitude at this latitude is about 84 m; of latitude,
    // about 111 m. The point is that BOTH are metres, not that they are equal.
    expect(ex).toBeGreaterThan(80);
    expect(ex).toBeLessThan(90);
    expect(ny).toBeGreaterThan(105);
    expect(ny).toBeLessThan(115);
  });

  it('drops the duplicated closing vertex GeoJSON rings carry', () => {
    expect(openRing([...SQUARE, [0, 0]])).toHaveLength(4);
    expect(openRing(SQUARE)).toHaveLength(4);
  });

  it('normalises winding without changing the shape', () => {
    expect(signedArea2(SQUARE)).toBeGreaterThan(0);
    const reversed = [...SQUARE].reverse();
    expect(signedArea2(reversed)).toBeLessThan(0);
    expect(signedArea2(toCCW(reversed))).toBeGreaterThan(0);
    expect(toCCW(SQUARE)).toEqual(SQUARE);
  });
});

describe('point in ring — the whole of the collision test', () => {
  it('knows inside from outside', () => {
    expect(pointInRing(SQUARE, 20, 15)).toBe(true);
    expect(pointInRing(SQUARE, -1, 15)).toBe(false);
    expect(pointInRing(SQUARE, 41, 15)).toBe(false);
    expect(pointInRing(SQUARE, 20, 31)).toBe(false);
  });

  it('handles a concave footprint, which most Manhattan blocks are', () => {
    const L: [number, number][] = [
      [0, 0], [40, 0], [40, 10], [10, 10], [10, 30], [0, 30],
    ];
    expect(pointInRing(L, 5, 20)).toBe(true);
    // The notch: inside the bounding box, outside the building.
    expect(pointInRing(L, 30, 20)).toBe(false);
  });

  it('measures the distance to the nearest wall and which way is out', () => {
    const near = nearestEdge(SQUARE, 3, 15);
    expect(near.distance).toBeCloseTo(3, 6);
    // Pushed away from the west wall means pushed east.
    expect(near.nx).toBeCloseTo(1, 6);
    expect(near.ny).toBeCloseTo(0, 6);
  });

  it('gives a usable direction for a point exactly on an edge', () => {
    const on = nearestEdge(SQUARE, 0, 15);
    expect(on.distance).toBeCloseTo(0, 6);
    expect(Math.hypot(on.nx, on.ny)).toBeCloseTo(1, 6);
  });
});

describe('triangulation', () => {
  it('turns a quad into two triangles', () => {
    expect(triangulate(SQUARE)).toHaveLength(6);
  });

  it('turns an n-gon into n-2 triangles', () => {
    const ring: [number, number][] = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return [Math.cos(a) * 20, Math.sin(a) * 20] as [number, number];
    });
    expect(triangulate(ring)).toHaveLength(10 * 3);
  });

  it('handles a concave polygon without emitting a triangle outside it', () => {
    const L: [number, number][] = [
      [0, 0], [40, 0], [40, 10], [10, 10], [10, 30], [0, 30],
    ];
    const tris = triangulate(L);
    expect(tris).toHaveLength(4 * 3);
    // Every triangle's centroid must be inside the polygon. A naive fan would
    // put one squarely in the notch.
    for (let i = 0; i < tris.length; i += 3) {
      const cx = (L[tris[i]][0] + L[tris[i + 1]][0] + L[tris[i + 2]][0]) / 3;
      const cy = (L[tris[i]][1] + L[tris[i + 1]][1] + L[tris[i + 2]][1]) / 3;
      expect(pointInRing(L, cx, cy)).toBe(true);
    }
  });

  it('gives the same answer whichever way the ring winds', () => {
    const forward = triangulate(SQUARE);
    const backward = triangulate([...SQUARE].reverse());
    expect(backward).toHaveLength(forward.length);
  });

  it('refuses to throw on a degenerate ring', () => {
    expect(triangulate([[0, 0], [1, 1]])).toEqual([]);
    expect(triangulate([[0, 0], [1, 1], [2, 2], [3, 3]])).toBeInstanceOf(Array);
  });

  describe('planar polygons in 3-D, which is what CityGML ships', () => {
    it('finds the normal of a horizontal roof', () => {
      const roof = [0, 0, 30, 10, 0, 30, 10, 10, 30, 0, 10, 30];
      expect(polygonNormal(roof)).toEqual([0, 0, 1]);
    });

    it('finds the normal of a vertical wall', () => {
      const wall = [0, 0, 0, 10, 0, 0, 10, 0, 20, 0, 0, 20];
      const [nx, ny, nz] = polygonNormal(wall);
      expect(Math.abs(nx)).toBeCloseTo(0, 6);
      expect(Math.abs(ny)).toBeCloseTo(1, 6);
      expect(Math.abs(nz)).toBeCloseTo(0, 6);
    });

    it('winds a downward-facing surface to match its own normal', () => {
      // A ground surface: same outline, wound so it faces down.
      const down = [0, 0, 0, 0, 10, 0, 10, 10, 0, 10, 0, 0];
      const normal = polygonNormal(down);
      expect(normal[2]).toBeLessThan(0);
      const tris = triangulatePlanar(down);
      expect(tris).toHaveLength(6);
      // The first triangle's own normal must point the same way as the
      // surface's. Getting this wrong makes half of every building vanish
      // under backface culling.
      const at = (i: number) => [down[i * 3], down[i * 3 + 1], down[i * 3 + 2]];
      const [a, b, c] = [at(tris[0]), at(tris[1]), at(tris[2])];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cz = u[0] * v[1] - u[1] * v[0];
      expect(Math.sign(cz)).toBe(Math.sign(normal[2]));
    });

    it('gives no normal a fallback rather than a NaN', () => {
      expect(polygonNormal([0, 0, 0, 1, 1, 1, 2, 2, 2])).toEqual([0, 0, 1]);
    });
  });
});

describe('massing', () => {
  it('extrudes a quad into four walls and a roof', () => {
    const m = extrudedMassing(SQUARE, 50);
    // Four walls at two triangles each, plus two for the roof.
    expect(m.triangles).toBe(10);
    expect(m.position).toHaveLength((4 * 4 + 4) * 3);
  });

  it('points every wall normal outward, whichever way the ring wound', () => {
    for (const ring of [SQUARE, [...SQUARE].reverse()]) {
      const m = extrudedMassing(ring, 50);
      const [cx, cy] = centroid(SQUARE);
      for (let i = 0; i < m.position.length / 3; i++) {
        if (m.isWall[i] < 0.5) continue;
        const px = m.position[i * 3];
        const py = m.position[i * 3 + 1];
        const nx = m.normal[i * 3];
        const ny = m.normal[i * 3 + 1];
        // The outward normal must point away from the centroid.
        expect((px - cx) * nx + (py - cy) * ny).toBeGreaterThan(0);
      }
    }
  });

  it('measures `along` in metres around the perimeter, never resetting', () => {
    const m = extrudedMassing(SQUARE, 50);
    // The perimeter of a 40x30 rectangle is 140 m, and the last wall's far
    // edge is at exactly that.
    expect(Math.max(...Array.from(m.along))).toBeCloseTo(140, 4);
  });

  it('measures `up` in metres above the ground, so a floor line is a floor', () => {
    const m = extrudedMassing(SQUARE, 50);
    expect(Math.max(...Array.from(m.up))).toBeCloseTo(50, 4);
    expect(Math.min(...Array.from(m.up))).toBeCloseTo(0, 4);
  });

  it('caps every setback, not just the top', () => {
    const steps = [
      { inset: 1, topM: 40 },
      { inset: 0.8, topM: 80 },
    ];
    const m = steppedMassing(SQUARE, steps);
    // Two rings of wall (8 triangles each) plus two caps (2 triangles each).
    // Missing the lower cap leaves a hole you can see the sky through, which
    // is a bug that only a screenshot finds.
    expect(m.triangles).toBe(8 + 8 + 2 + 2);
  });

  it('leaves no gap between one step and the next', () => {
    const m = steppedMassing(SQUARE, [
      { inset: 1, topM: 40 },
      { inset: 0.8, topM: 80 },
    ]);
    const ups = new Set(Array.from(m.up).map((v) => Math.round(v)));
    expect(ups.has(0)).toBe(true);
    expect(ups.has(40)).toBe(true);
    expect(ups.has(80)).toBe(true);
  });

  it('insets about the centroid, keeping the footprint shape', () => {
    const inner = insetRingLocal(SQUARE, 0.5);
    const [cx, cy] = centroid(SQUARE);
    expect(centroid(inner)[0]).toBeCloseTo(cx, 6);
    expect(centroid(inner)[1]).toBeCloseTo(cy, 6);
    // Halving the radius quarters the area.
    expect(Math.abs(signedArea2(inner))).toBeCloseTo(Math.abs(signedArea2(SQUARE)) * 0.25, 4);
  });

  describe('the fallback profile — silhouette from year built alone', () => {
    it('does not step a low-rise, which would be a building that cannot exist', () => {
      expect(fallbackSteps(30, 1925)).toHaveLength(1);
      expect(fallbackSteps(30, 1925)[0].inset).toBe(1);
    });

    it('gives a pre-war tower setbacks, because the 1916 code required them', () => {
      const steps = fallbackSteps(200, 1931);
      expect(steps.length).toBeGreaterThan(2);
      expect(steps[steps.length - 1].inset).toBeLessThan(1);
    });

    it('gives a post-war tower a straight shaft', () => {
      const steps = fallbackSteps(200, 1963);
      expect(steps).toHaveLength(2);
      expect(steps[0].inset).toBe(1);
    });

    it('always reaches the building height exactly', () => {
      for (const year of [1900, 1931, 1963, 1999, null]) {
        for (const h of [20, 60, 200, 440]) {
          const steps = fallbackSteps(h, year);
          expect(steps[steps.length - 1].topM).toBeCloseTo(h, 6);
        }
      }
    });

    it('never widens going up', () => {
      for (const year of [1900, 1931, 1963, 1999]) {
        const steps = fallbackSteps(300, year);
        for (let i = 1; i < steps.length; i++) {
          expect(steps[i].inset).toBeLessThanOrEqual(steps[i - 1].inset);
          expect(steps[i].topM).toBeGreaterThan(steps[i - 1].topM);
        }
      }
    });
  });

  it('merges several buildings into one buffer with the indices rebased', () => {
    const a = extrudedMassing(SQUARE, 50);
    const b = extrudedMassing(insetRingLocal(SQUARE, 0.5), 80);
    const merged = mergeMassings([a, b]);
    expect(merged.triangles).toBe(a.triangles + b.triangles);
    expect(Math.max(...Array.from(merged.index))).toBe(
      merged.position.length / 3 - 1,
    );
  });
});

describe('where a band goes on a building that steps', () => {
  it('uses the full footprint below the first setback', () => {
    const steps = fallbackSteps(300, 1931);
    expect(insetAtHeight(steps, 10)).toBe(1);
  });

  it('narrows above it — which is the whole point of §5', () => {
    const steps = fallbackSteps(300, 1931);
    const low = insetAtHeight(steps, 10);
    const high = insetAtHeight(steps, 290);
    expect(high).toBeLessThan(low);
  });

  it('pins a floor above the roof to the topmost step rather than the plot', () => {
    const steps = fallbackSteps(300, 1931);
    expect(insetAtHeight(steps, 9999)).toBe(steps[steps.length - 1].inset);
  });

  it('recovers the collar radius a band was drawn with', () => {
    const collar = insetRingLocal(SQUARE, 1.035);
    expect(collarOf(SQUARE, collar)).toBeCloseTo(1.035, 6);
  });

  it('returns 1 rather than a wrong number when the rings do not correspond', () => {
    expect(collarOf(SQUARE, [[0, 0]])).toBe(1);
    expect(collarOf([], [])).toBe(1);
  });
});

const deg = (r: number) => (r * 180) / Math.PI;
/** Azimuth as a compass bearing in 0-360, which is how it reads. */
const compass = (r: number) => ((deg(r) % 360) + 360) % 360;

describe('the sun', () => {
  it('counts days from J2000 correctly', () => {
    // 2000-01-01 12:00 UTC is day zero by definition.
    expect(julianDays(Date.UTC(2000, 0, 1, 12, 0))).toBeCloseTo(0, 6);
  });

  it('puts the midsummer sun high and south over Manhattan at local noon', () => {
    // 21 June 2025, 17:00 UTC is 13:00 EDT.
    const { altitude, azimuth } = sunPosition(Date.UTC(2025, 5, 21, 17, 0), -73.98, 40.75);
    // Manhattan's midsummer noon sun tops out around 73°.
    expect(deg(altitude)).toBeGreaterThan(65);
    expect(deg(altitude)).toBeLessThan(76);
    // Azimuth is clockwise from north, so due south is 180° — not zero. The
    // convention matters: read it as "clockwise from south" and every shadow
    // in the city falls the wrong way.
    expect(compass(azimuth)).toBeGreaterThan(150);
    expect(compass(azimuth)).toBeLessThan(210);
  });

  it('puts the sun below the horizon in the middle of the night', () => {
    const { altitude } = sunPosition(Date.UTC(2025, 5, 22, 5, 0), -73.98, 40.75);
    expect(altitude).toBeLessThan(0);
  });

  it('puts the morning sun in the east and the evening sun in the west', () => {
    // 12:00 UTC is 08:00 EDT; 22:00 UTC is 18:00 EDT.
    const morning = sunPosition(Date.UTC(2025, 5, 21, 12, 0), -73.98, 40.75);
    const evening = sunPosition(Date.UTC(2025, 5, 21, 22, 0), -73.98, 40.75);
    expect(compass(morning.azimuth)).toBeGreaterThan(45);
    expect(compass(morning.azimuth)).toBeLessThan(120);
    expect(compass(evening.azimuth)).toBeGreaterThan(255);
    expect(compass(evening.azimuth)).toBeLessThan(320);
  });

  it('sends light westward in the morning and eastward in the evening', () => {
    // The direction light TRAVELS, which is the opposite of where the sun is.
    // This is the sign that decides which face of a tower is lit, and it is
    // the one an off-by-a-minus-sign bug hides in.
    const morning = sunDirection(Date.UTC(2025, 5, 21, 12, 0), -73.98, 40.75);
    const evening = sunDirection(Date.UTC(2025, 5, 21, 22, 0), -73.98, 40.75);
    expect(morning[0]).toBeLessThan(0);
    expect(evening[0]).toBeGreaterThan(0);
  });

  it('hands back a unit vector pointing down, even at night', () => {
    for (const t of [
      Date.UTC(2025, 5, 21, 14, 30),
      Date.UTC(2025, 5, 21, 17, 0),
      Date.UTC(2025, 5, 21, 23, 15),
      Date.UTC(2025, 5, 22, 5, 0),
    ]) {
      const d = sunDirection(t, -73.98, 40.75);
      expect(Math.hypot(...d)).toBeCloseTo(1, 6);
      // Light travels downward. A light vector pointing up out of the
      // pavement lights only the undersides of things, which at night is
      // exactly what a naive clamp produces.
      expect(d[2]).toBeLessThan(0);
    }
  });
});

describe('the camera', () => {
  it('knows how many metres a pixel covers', () => {
    // At zoom 0 the whole equator is 512 px.
    expect(metersPerPixel(0, 0)).toBeCloseTo(40_075_016.686 / 512, 3);
    // And each zoom level halves it.
    expect(metersPerPixel(40.75, 15)).toBeCloseTo(metersPerPixel(40.75, 16) * 2, 6);
  });

  it('puts the camera straight up at zero pitch', () => {
    const c = cameraOffset({
      center: [-73.98, 40.75], zoom: 16, pitch: 0, bearing: 0, height: 1000,
    });
    expect(c.east).toBeCloseTo(0, 6);
    expect(c.north).toBeCloseTo(0, 6);
    expect(c.altitude).toBeCloseTo(c.distance, 6);
  });

  it('puts the camera behind the centre as the map pitches', () => {
    const c = cameraOffset({
      center: [-73.98, 40.75], zoom: 16, pitch: 60, bearing: 0, height: 1000,
    });
    // Bearing 0 means north is up, so the camera is to the SOUTH of centre.
    expect(c.north).toBeLessThan(0);
    expect(c.east).toBeCloseTo(0, 6);
    expect(c.altitude).toBeLessThan(c.distance);
  });

  it('swings the camera round with the bearing', () => {
    const east = cameraOffset({
      center: [-73.98, 40.75], zoom: 16, pitch: 60, bearing: 90, height: 1000,
    });
    // Up-screen is east, so the camera sits to the west.
    expect(east.east).toBeLessThan(0);
    expect(Math.abs(east.north)).toBeLessThan(1e-6);
  });

  it('holds MapLibre\'s own field of view', () => {
    // 36.87°, which is 2·atan(0.5/1.5) — not a number to be tuned.
    expect((MAPLIBRE_FOV * 180) / Math.PI).toBeCloseTo(36.87, 2);
  });

  it('round-trips an eye position back through the view that produces it', () => {
    const eye: [number, number, number] = [0, 0, 1.7];
    const { centerOffset, zoom } = viewForEye({
      eye, bearing: 30, pitch: 80, height: 1000, lat: 40.75,
    });
    const back = cameraOffset({
      center: [-73.98, 40.75], zoom, pitch: 80, bearing: 30, height: 1000,
    });
    // The camera derived from that view must land back at eye level.
    expect(back.altitude).toBeCloseTo(eye[2], 3);
    // And the centre it looks at must be the offset we asked for.
    expect(Math.hypot(centerOffset[0] + back.east, centerOffset[1] + back.north))
      .toBeLessThan(0.01);
  });

  it('does not divide by zero when a walker looks at the horizon', () => {
    const { zoom } = viewForEye({
      eye: [0, 0, 1.7], bearing: 0, pitch: 90, height: 1000, lat: 40.75,
    });
    expect(Number.isFinite(zoom)).toBe(true);
  });
});
