import { describe, expect, it } from 'vitest';
import {
  layoutWalkLabels,
  metersBetween,
  nearestStops,
  walkLabelsCollide,
  walkMinutes,
  type NearbyStop,
  type TransitStop,
} from '../src/lib/transit';

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
