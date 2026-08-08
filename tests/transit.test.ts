import { describe, expect, it } from 'vitest';
import {
  DASH_M,
  MODE_REACH_M,
  dashPath,
  layoutWalkLabels,
  metersBetween,
  nearestStops,
  walkLabelsCollide,
  walkMinutes,
  type NearbyStop,
  type TransitStop,
} from '../src/lib/transit';
import { WALK_DARK, WALK_LIGHT } from '../src/components/map/colors';
import { BRAND, rgba } from '../src/lib/brand';

const GCT: [number, number] = [-73.9772, 40.7527];

const STOPS: TransitStop[] = [
  { id: 'a', lon: -73.9772, lat: 40.7537, name: 'Close subway', mode: 'subway', routes: ['4', '5', '6'] },
  { id: 'b', lon: -73.9782, lat: 40.7527, name: 'Close bus', mode: 'bus', routes: ['M42'] },
  { id: 'c', lon: -73.9792, lat: 40.7527, name: 'Second bus', mode: 'bus', routes: ['M101'] },
  { id: 'd', lon: -73.9802, lat: 40.7527, name: 'Third bus', mode: 'bus', routes: ['M102'] },
  { id: 'e', lon: -73.9200, lat: 40.7527, name: 'Far ferry', mode: 'ferry', routes: [] },
];

describe('walking estimates', () => {
  it('measures real-world distance', () => {
    // One tenth of a degree of latitude is about 11.1km.
    expect(metersBetween([-73.98, 40.75], [-73.98, 40.85])).toBeGreaterThan(11_000);
    expect(metersBetween([-73.98, 40.75], [-73.98, 40.85])).toBeLessThan(11_200);
  });

  it('walks a block in a plausible number of minutes', () => {
    // ~250m: a long Manhattan block. Detour and pace put it at 3-4 minutes.
    const mins = walkMinutes(250);
    expect(mins).toBeGreaterThanOrEqual(3);
    expect(mins).toBeLessThanOrEqual(4);
  });

  it('never reports a zero-minute walk', () => {
    expect(walkMinutes(1)).toBe(1);
    expect(walkMinutes(0)).toBe(1);
  });
});

describe('nearestStops', () => {
  it('sorts by distance', () => {
    const near = nearestStops(GCT, STOPS, { limit: 10, maxMeters: 5000 });
    expect(near[0].id).toBe('b');
    expect(near.map((s) => s.meters)).toEqual([...near.map((s) => s.meters)].sort((a, b) => a - b));
  });

  it('drops anything beyond the radius', () => {
    const near = nearestStops(GCT, STOPS, { maxMeters: 500 });
    expect(near.find((s) => s.id === 'e')).toBeUndefined();
  });

  it('keeps a subway from being buried by nearer bus stops', () => {
    // Without a per-mode quota, three bus stops crowd out the subway.
    const near = nearestStops(GCT, STOPS, { limit: 3, maxMeters: 5000, perMode: 2 });
    expect(near.some((s) => s.mode === 'subway')).toBe(true);
    expect(near.filter((s) => s.mode === 'bus')).toHaveLength(2);
  });
});

describe('how far each mode is worth walking', () => {
  /**
   * One radius for every mode had a specific, visible cost: under a flat
   * 1200m, Grand Central disappeared from every building in Midtown South,
   * and Compare's rail row filled up with PATH instead — which is a different
   * commute, answered in a row labelled for another one.
   */
  const FAR: TransitStop[] = [
    // ~1.7km north: beyond a bus's reach, well inside a terminal's.
    { id: 'terminal', lon: -73.9772, lat: 40.7680, name: 'Grand Central Terminal', mode: 'rail', routes: ['Metro-North'] },
    { id: 'farbus', lon: -73.9772, lat: 40.7620, name: 'Far bus', mode: 'bus', routes: ['M1'] },
  ];

  it('keeps a rail terminal that a bus stop would be dropped for', () => {
    const near = nearestStops(GCT, FAR, { limit: 10 });
    expect(near.map((s) => s.id)).toContain('terminal');
    expect(near.map((s) => s.id)).not.toContain('farbus');
  });

  it('ranks the reaches the way a tenant would', () => {
    expect(MODE_REACH_M.rail).toBeGreaterThan(MODE_REACH_M.subway);
    expect(MODE_REACH_M.subway).toBeGreaterThan(MODE_REACH_M.bus);
  });

  it('still lets an explicit radius win, for the lines the map draws', () => {
    // The walk lines want one tight radius for every mode: those are drawn,
    // not read, and a 2.4km dashed line across the island is noise.
    const near = nearestStops(GCT, FAR, { limit: 10, maxMeters: 500 });
    expect(near).toHaveLength(0);
  });

  it('covers every mode, so none silently falls back', () => {
    for (const mode of ['subway', 'bus', 'ferry', 'rail', 'path', 'tram'] as const) {
      expect(MODE_REACH_M[mode], mode).toBeGreaterThan(0);
    }
  });
});

describe('the walk line reads as a route', () => {
  /** A straight 1km run north, as one segment. */
  const LEG: [number, number][] = [GCT, [GCT[0], GCT[1] + 0.009]];

  const lengthOf = (path: [number, number][]) => metersBetween(path[0], path[1]);

  it('lays more ink than gap, so it is a dashed line and not a dotted one', () => {
    const dashes = dashPath(LEG);
    const ink = dashes.reduce((sum, d) => sum + lengthOf(d), 0);
    const total = metersBetween(LEG[0], LEG[1]);
    // Equal on and off reads as texture. At the zoom this is used at, the
    // dashes dissolved into scattered ticks and the route stopped being one.
    expect(ink / total).toBeGreaterThan(0.6);
  });

  it('keeps the rhythm even, so it does not read as a broken line', () => {
    const dashes = dashPath(LEG);
    expect(dashes.length).toBeGreaterThan(5);
    // Every dash but the last one, which the end of the leg cuts short.
    for (const d of dashes.slice(0, -1)) {
      expect(lengthOf(d)).toBeCloseTo(DASH_M, 0);
    }
  });

  it('carries the rhythm across a corner rather than restarting it', () => {
    // A route along the grid turns; a dash that restarts at every vertex puts
    // a joint at every corner and the eye reads it as a series of segments.
    const corner: [number, number][] = [GCT, [GCT[0], GCT[1] + 0.0005], [GCT[0] + 0.0006, GCT[1] + 0.0005]];
    const dashes = dashPath(corner);
    const straight = dashPath([GCT, [GCT[0], GCT[1] + 0.0011]]);
    expect(Math.abs(dashes.length - straight.length)).toBeLessThanOrEqual(1);
  });

  it('takes a dash and a gap independently', () => {
    // Same period, opposite duty cycle: the count is identical and the ink is
    // not, which is the whole reason the two lengths had to be separated.
    const ink = (path: [number, number][][]) =>
      path.reduce((sum, d) => sum + lengthOf(d), 0);
    const sparse = dashPath(LEG, 10, 40);
    const dense = dashPath(LEG, 40, 10);
    expect(ink(dense)).toBeGreaterThan(ink(sparse) * 3);
    expect(lengthOf(dense[0])).toBeCloseTo(40, 0);
    expect(lengthOf(sparse[0])).toBeCloseTo(10, 0);
  });

  it('handles a degenerate path without looping', () => {
    expect(dashPath([])).toEqual([]);
    expect(dashPath([GCT])).toEqual([]);
    expect(dashPath([GCT, GCT])).toEqual([]);
  });
});

describe('the walk line is never Goldenrod', () => {
  /**
   * It was, and that was a breach of the one rule this map serves: Goldenrod
   * means available space and nothing else. Five gold dashes on the pavement
   * beside one tower with gold bands on it out-shouted the thing they exist to
   * give context to.
   */
  const gold = rgba(BRAND.goldenrod);

  for (const [name, colors] of [['light', WALK_LIGHT], ['dark', WALK_DARK]] as const) {
    it(`on the ${name} map`, () => {
      for (const key of ['line', 'casing', 'labelBg'] as const) {
        const [r, g, b] = colors[key];
        const distance = Math.abs(r - gold[0]) + Math.abs(g - gold[1]) + Math.abs(b - gold[2]);
        expect(distance, `${name}.${key}`).toBeGreaterThan(120);
      }
    });

    it(`has a casing that contrasts with its own dash on the ${name} map`, () => {
      // The casing exists to make the route continuous where a dash is only a
      // few pixels. A casing the same tone as the dash does nothing at all.
      const lum = ([r, g, b]: readonly number[]) => 0.299 * r + 0.587 * g + 0.114 * b;
      expect(Math.abs(lum(colors.line) - lum(colors.casing))).toBeGreaterThan(90);
    });
  }
});

describe('layoutWalkLabels', () => {
  const origin: [number, number] = [-73.9772, 40.7527];

  /** Builds stops at given bearings (degrees) and distances (metres). */
  function fan(specs: [number, number][]): NearbyStop[] {
    return specs.map(([deg, meters], i) => {
      const rad = (deg * Math.PI) / 180;
      const dLat = (meters * Math.cos(rad)) / 111_320;
      const dLon = (meters * Math.sin(rad)) / (111_320 * Math.cos((origin[1] * Math.PI) / 180));
      return {
        id: `s${i}`,
        lon: origin[0] + dLon,
        lat: origin[1] + dLat,
        name: `Stop ${i}`,
        mode: 'bus',
        routes: [],
        meters,
        minutes: walkMinutes(meters),
      };
    });
  }

  function minGap(labels: ReturnType<typeof layoutWalkLabels>): number {
    let min = Infinity;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        min = Math.min(min, metersBetween(labels[i].position, labels[j].position));
      }
    }
    return min;
  }

  it('separates labels that would otherwise stack', () => {
    // The failing case: stops at nearly the same bearing and distance, which
    // put every pill on the same point of the same circle.
    const stops = fan([
      [10, 400],
      [14, 410],
      [18, 395],
      [22, 405],
    ]);
    const labels = layoutWalkLabels(origin, stops);
    const naive = stops.map(
      (s) =>
        [origin[0] + (s.lon - origin[0]) * 0.62, origin[1] + (s.lat - origin[1]) * 0.62] as [
          number,
          number,
        ],
    );
    let naiveMin = Infinity;
    for (let i = 0; i < naive.length; i++) {
      for (let j = i + 1; j < naive.length; j++) {
        naiveMin = Math.min(naiveMin, metersBetween(naive[i], naive[j]));
      }
    }
    expect(minGap(labels)).toBeGreaterThan(naiveMin * 2);
  });

  it('leaves no pair of pills overlapping', () => {
    // Five stops crowded into a 30-degree arc — the map draws at most five,
    // and this is the worst arrangement of them: nearly the same bearing and
    // nearly the same distance, so every label starts on top of the others.
    const stops = fan([
      [5, 380],
      [11, 400],
      [17, 420],
      [23, 390],
      [29, 410],
    ]);
    const labels = layoutWalkLabels(origin, stops);
    expect(labels.length).toBeGreaterThan(0);
    const maxMeters = Math.max(...stops.map((s) => s.meters));
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        expect(
          walkLabelsCollide(labels[i].position, labels[j].position, maxMeters),
        ).toBe(0);
      }
    }
  });

  it('keeps every label on its own walk line', () => {
    const stops = fan([
      [0, 300],
      [90, 500],
      [200, 250],
      [300, 700],
    ]);
    for (const { stop, position, t } of layoutWalkLabels(origin, stops)) {
      expect(position[0]).toBeCloseTo(origin[0] + (stop.lon - origin[0]) * t, 10);
      expect(position[1]).toBeCloseTo(origin[1] + (stop.lat - origin[1]) * t, 10);
      expect(t).toBeGreaterThan(0.3);
      expect(t).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the subway label when crowding forces some to be dropped', () => {
    // A subway station surrounded by nearer bus stops at the same bearing.
    const stops = fan([
      [10, 250],
      [12, 280],
      [14, 310],
      [16, 340],
    ]);
    stops[3] = { ...stops[3], mode: 'subway', routes: ['4', '5', '6'], name: 'Grand Central' };

    const labels = layoutWalkLabels(origin, stops);
    expect(labels.some((l) => l.stop.mode === 'subway')).toBe(true);
  });

  it('is deterministic, so labels do not jitter between frames', () => {
    const stops = fan([
      [5, 400],
      [9, 420],
      [180, 600],
    ]);
    const a = layoutWalkLabels(origin, stops).map((l) => l.t);
    const b = layoutWalkLabels(origin, stops).map((l) => l.t);
    expect(a).toEqual(b);
  });

  it('handles a single stop and an empty list', () => {
    expect(layoutWalkLabels(origin, [])).toEqual([]);
    expect(layoutWalkLabels(origin, fan([[45, 300]]))).toHaveLength(1);
  });
});
