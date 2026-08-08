import { describe, expect, it } from 'vitest';
import { metersBetween, nearestStops, walkMinutes, type TransitStop } from '../src/lib/transit';

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
