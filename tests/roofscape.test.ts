import { describe, expect, it } from 'vitest';
import {
  computeRoofscape,
  offsetMeters,
  ringCentroid,
  ringRadiusM,
  roofEra,
  seededUnit,
  squareAround,
} from '../src/lib/roofscape';
import type { Building } from '../src/types';

const LAT = 40.75;

/** A square footprint of the given half-width in metres, at Midtown latitude. */
function footprint(halfM: number): [number, number][] {
  return squareAround([-73.98, LAT], halfM);
}

function building(patch: Partial<Building>): Building {
  return {
    id: 'b1',
    bin: '1000001',
    bbl: null,
    address_normalized: '',
    address_display: '',
    building_name: null,
    landlord_id: null,
    class: 'A',
    submarket: null,
    submarket_cluster: null,
    num_floors: 12,
    height_roof_ft: 150,
    year_built: 1913,
    bldg_area_sf: null,
    lon: -73.98,
    lat: LAT,
    footprint: footprint(24),
    match_confidence: 'exact',
    floor_height_override: null,
    notes: null,
    updated_at: '',
    ...patch,
  } as Building;
}

describe('roofEra', () => {
  it('splits at the two real breaks in how New York finished a building', () => {
    expect(roofEra(1913)).toBe('prewar');
    expect(roofEra(1944)).toBe('prewar');
    expect(roofEra(1945)).toBe('midcentury');
    expect(roofEra(1979)).toBe('midcentury');
    expect(roofEra(1980)).toBe('modern');
    expect(roofEra(2015)).toBe('modern');
  });

  it('falls back to midcentury when the year is unknown', () => {
    expect(roofEra(null)).toBe('midcentury');
    expect(roofEra(Number.NaN)).toBe('midcentury');
  });
});

describe('seededUnit', () => {
  it('is stable, so a roof never reshuffles between renders', () => {
    expect(seededUnit('1035319', 3)).toBe(seededUnit('1035319', 3));
  });

  it('stays inside [0, 1)', () => {
    for (const key of ['1035319', 'a', '', 'zzzzzzzzzzzz', '999999999']) {
      for (let salt = 0; salt < 40; salt++) {
        const v = seededUnit(key, salt);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('decorrelates adjacent BINs, which are consecutive integers', () => {
    // Without the avalanche rounds, 1035319 and 1035320 produce near-identical
    // values and a whole block of buildings gets the same roof.
    const a = seededUnit('1035319', 5);
    const b = seededUnit('1035320', 5);
    expect(Math.abs(a - b)).toBeGreaterThan(0.02);
  });

  it('gives different answers for different salts', () => {
    expect(seededUnit('1035319', 1)).not.toBe(seededUnit('1035319', 2));
  });
});

describe('ring geometry', () => {
  it('measures a square footprint at close to its true radius', () => {
    // Mean distance from centre to the corners of a 48m square. The ring
    // repeats its first vertex, so the mean is over the closing ring.
    const r = ringRadiusM(footprint(24));
    expect(r).toBeGreaterThan(28);
    expect(r).toBeLessThan(36);
  });

  it('centres on the middle of the footprint', () => {
    const [lon, lat] = ringCentroid(footprint(24));
    expect(lon).toBeCloseTo(-73.98, 6);
    expect(lat).toBeCloseTo(LAT, 6);
  });

  it('ignores the repeated closing vertex, which would drag the centre', () => {
    // A closed ring repeats its first vertex. Averaging it twice pulls the
    // centroid metres toward that corner — enough to sit a water tank visibly
    // off-centre on a small footprint.
    const open: [number, number][] = [
      [-73.98, LAT],
      [-73.979, LAT],
      [-73.979, LAT + 0.001],
      [-73.98, LAT + 0.001],
    ];
    const closed: [number, number][] = [...open, open[0]];
    expect(ringCentroid(closed)).toEqual(ringCentroid(open));
  });

  it('corrects longitude for latitude, so a square is square on the ground', () => {
    const ring = squareAround([-73.98, LAT], 50);
    const widthDeg = ring[1][0] - ring[0][0];
    const heightDeg = ring[2][1] - ring[1][1];
    // At 40.75°N a degree of longitude is ~76% of a degree of latitude, so a
    // ground-square must be WIDER in degrees than it is tall.
    expect(widthDeg / heightDeg).toBeCloseTo(1 / Math.cos((LAT * Math.PI) / 180), 2);
  });

  it('offsets east at 0 radians and north at a quarter turn', () => {
    const [eLon, eLat] = offsetMeters([-73.98, LAT], 100, 0);
    expect(eLon).toBeGreaterThan(-73.98);
    expect(eLat).toBeCloseTo(LAT, 6);

    const [nLon, nLat] = offsetMeters([-73.98, LAT], 100, Math.PI / 2);
    expect(nLon).toBeCloseTo(-73.98, 6);
    expect(nLat).toBeGreaterThan(LAT);
  });
});

describe('computeRoofscape', () => {
  it('gives every building a parapet standing on its roof', () => {
    const roof = computeRoofscape(building({ height_roof_ft: 150 }));
    expect(roof.parapet).not.toBeNull();
    expect(roof.parapet!.baseFt).toBe(150);
    expect(roof.parapet!.heightFt).toBeGreaterThan(0);
    // Outer ring and inner ring — a wall, not a lid over the whole roof.
    expect(roof.parapet!.rings).toHaveLength(2);
  });

  it('puts a water tank on a frame on a pre-war loft', () => {
    const roof = computeRoofscape(building({ year_built: 1913, num_floors: 12 }));
    expect(roof.era).toBe('prewar');
    expect(roof.tanks.length).toBeGreaterThan(0);
    const tank = roof.tanks[0];
    // The tank sits on top of its legs, not flat on the roof — a tank on the
    // deck reads as a chimney.
    expect(tank.baseFt).toBeGreaterThan(150);
    expect(roof.posts.some((p) => p.baseFt === 150)).toBe(true);
  });

  it('gives a post-war tower a mechanical slab and no water tank', () => {
    const roof = computeRoofscape(
      building({ year_built: 1963, height_roof_ft: 808, num_floors: 59 }),
    );
    expect(roof.era).toBe('midcentury');
    expect(roof.tanks).toHaveLength(0);
    expect(roof.bulkheads.length).toBeGreaterThan(0);
  });

  it('ends a 1920s tower and an eighties tower differently', () => {
    const shape = (b: Building) => {
      const r = computeRoofscape(b);
      return `${r.era}/${r.setbacks.length}/${r.tanks.length}/${r.bulkheads.length}`;
    };
    const twenties = shape(
      building({ year_built: 1929, height_roof_ft: 669, num_floors: 55 }),
    );
    const eighties = shape(
      building({ id: 'b2', bin: '1035747', year_built: 1983, height_roof_ft: 470, num_floors: 36 }),
    );
    expect(twenties).not.toBe(eighties);
  });

  it('steps the crown of a tall pre-war tower and leaves a low-rise alone', () => {
    const tall = computeRoofscape(
      building({ year_built: 1931, height_roof_ft: 704, num_floors: 58 }),
    );
    expect(tall.setbacks.length).toBeGreaterThan(0);

    const low = computeRoofscape(building({ year_built: 1911, height_roof_ft: 150 }));
    expect(low.setbacks).toHaveLength(0);
  });

  it('stacks setback tiers upward without gaps or overlaps', () => {
    const roof = computeRoofscape(
      building({ year_built: 1931, height_roof_ft: 704, num_floors: 58 }),
    );
    let expectedBase = 704;
    for (const tier of roof.setbacks) {
      expect(tier.baseFt).toBeCloseTo(expectedBase, 5);
      expectedBase += tier.heightFt;
    }
  });

  it('keeps every piece at or above the roof, never floating below it', () => {
    for (const year of [1913, 1929, 1963, 1983]) {
      const roof = computeRoofscape(
        building({ year_built: year, height_roof_ft: 500, num_floors: 40 }),
      );
      const bases = [
        ...(roof.parapet ? [roof.parapet.baseFt] : []),
        ...roof.setbacks.map((s) => s.baseFt),
        ...roof.bulkheads.map((b) => b.baseFt),
        ...roof.tanks.map((t) => t.baseFt),
        ...roof.posts.map((p) => p.baseFt),
      ];
      expect(bases.length).toBeGreaterThan(0);
      for (const base of bases) expect(base).toBeGreaterThanOrEqual(500);
    }
  });

  it('is deterministic for the same building', () => {
    const b = building({ year_built: 1913 });
    expect(JSON.stringify(computeRoofscape(b))).toBe(JSON.stringify(computeRoofscape(b)));
  });

  it('returns an empty roofscape rather than throwing without a footprint', () => {
    const roof = computeRoofscape(building({ footprint: null, lon: null, lat: null }));
    expect(roof.parapet).toBeNull();
    expect(roof.bulkheads).toHaveLength(0);
  });
});
