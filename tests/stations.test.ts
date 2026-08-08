import { describe, expect, it } from 'vitest';
import { dedupeStations, stationLabelText } from '../src/components/map/stations';
import type { TransitStop } from '../src/lib/transit';

function stop(patch: Partial<TransitStop>): TransitStop {
  return {
    id: 'x',
    name: 'Grand Central-42 St',
    mode: 'subway',
    lon: -73.9772,
    lat: 40.7527,
    routes: ['4', '5', '6'],
    ...patch,
  } as TransitStop;
}

describe('dedupeStations', () => {
  it('collapses the several rows one station is filed under', () => {
    // A subway station appears once per platform or complex member, all within
    // a few metres. Modelling each stacks kiosks on one corner and stacks
    // identical name plates on top of them.
    const stops = [
      stop({ id: 'a', routes: ['4'] }),
      stop({ id: 'b', lon: -73.97721, lat: 40.75271, routes: ['4', '5', '6', '7', 'S'] }),
      stop({ id: 'c', lon: -73.97719, routes: ['6'] }),
    ];
    const out = dedupeStations(stops);
    expect(out).toHaveLength(1);
    // The survivor is the one serving the most routes — the main entrance of
    // the complex rather than one platform edge.
    expect(out[0].id).toBe('b');
  });

  it('keeps genuinely different stations apart', () => {
    const out = dedupeStations([
      stop({ id: 'a', name: 'Grand Central-42 St' }),
      stop({ id: 'b', name: '5 Av-Bryant Pk', lon: -73.9816, lat: 40.7539 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps same-named stations that are far apart', () => {
    // "23 St" is five different stations on five different lines.
    const out = dedupeStations([
      stop({ id: 'a', name: '23 St', lon: -73.9955, lat: 40.7441 }),
      stop({ id: 'b', name: '23 St', lon: -73.9862, lat: 40.7411 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('handles an empty list', () => {
    expect(dedupeStations([])).toEqual([]);
  });
});

describe('stationLabelText', () => {
  it('leads with the station name, which is what a tenant asks about', () => {
    // Knowing a stop is a subway is not the same as knowing it is Grand
    // Central.
    expect(stationLabelText(stop({}))).toBe('Grand Central-42 St\n4 5 6');
  });

  it('carries routes only where they are short enough to read', () => {
    // Rail route names are words — "Metro-North LIRR" is wider than the plate.
    const rail = stationLabelText(stop({ mode: 'rail', name: 'Penn Station', routes: ['LIRR'] }));
    expect(rail).toBe('Penn Station\nRail');
  });

  it('falls back to the mode when a subway stop lists no routes', () => {
    expect(stationLabelText(stop({ routes: [] }))).toBe('Grand Central-42 St\nSubway');
  });

  it('caps a long route list rather than letting the plate grow', () => {
    const many = stationLabelText(
      stop({ routes: ['A', 'C', 'E', 'B', 'D', 'F', 'M', 'N', 'Q', 'R'] }),
    );
    expect(many.split('\n')[1].split(' ')).toHaveLength(6);
  });
});
