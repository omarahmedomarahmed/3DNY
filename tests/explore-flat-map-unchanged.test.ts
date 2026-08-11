import { beforeEach, describe, expect, it } from 'vitest';
import type { Massing } from '@/lib/citygml';
import { ingest, resetLod2 } from '@/lib/explore/lod2-registry';
import { bandRingAt } from '@/lib/explore/profile';
import { computeBands, computeFloorLines, spaceClaims, buildingRing } from '@/lib/floor-bands';
import type { Building, BuildingWithSpaces, Space } from '@/types';

/**
 * The flat map is not allowed to change. This is the guard.
 *
 * Explore mode added a whole second source of truth about what a building
 * looks like — NYC's surveyed massing — and the danger is not that it is
 * wrong. It is that it leaks. `computeBands`, `computeFloorLines` and
 * `buildingRing` are shared by both modes, and the day one of them starts
 * consulting the surveyed massing is the day the flat map's geometry changes
 * under a broker with no warning and no reason.
 *
 * So: load the surveyed massing, and assert the flat map's own maths does not
 * notice. The Explore-only path is checked alongside, in the same test, so
 * that a change which accidentally swaps the two over cannot pass.
 */

const FOOTPRINT: [number, number][] = [
  [-73.9805, 40.7495],
  [-73.9795, 40.7495],
  [-73.9795, 40.7505],
  [-73.9805, 40.7505],
];

/** A tower whose shaft is a third of its plot and sits 12 m off-centre. */
const TOWER: Massing = {
  anchor: [-73.98, 40.75],
  topM: 200,
  surfaces: [
    { k: 'W', p: [-30, -15, 0, 30, -15, 0, 30, -15, 40, -30, -15, 40] },
    { k: 'W', p: [30, -15, 0, 30, 15, 0, 30, 15, 40, 30, -15, 40] },
    { k: 'W', p: [30, 15, 0, -30, 15, 0, -30, 15, 40, 30, 15, 40] },
    { k: 'W', p: [-30, 15, 0, -30, -15, 0, -30, -15, 40, -30, 15, 40] },
    { k: 'W', p: [2, -6, 40, 22, -6, 40, 22, -6, 200, 2, -6, 200] },
    { k: 'W', p: [22, -6, 40, 22, 6, 40, 22, 6, 200, 22, -6, 200] },
    { k: 'W', p: [22, 6, 40, 2, 6, 40, 2, 6, 200, 22, 6, 200] },
    { k: 'W', p: [2, 6, 40, 2, -6, 40, 2, -6, 200, 2, 6, 200] },
    { k: 'R', p: [2, -6, 200, 22, -6, 200, 22, 6, 200, 2, 6, 200] },
  ],
};

const SPACES: Space[] = [
  {
    id: 's1',
    floor_number: 40,
    floor_portion: 'entire',
    is_active: true,
  } as unknown as Space,
];

const BUILDING = {
  id: 'b1',
  bin: '9999999',
  footprint: FOOTPRINT,
  lon: -73.98,
  lat: 40.75,
  height_roof_ft: 200 / 0.3048,
  num_floors: 50,
  year_built: 1931,
  floor_height_override: null,
  spaces: SPACES,
} as unknown as BuildingWithSpaces;

const ASSET = {
  version: 1,
  source: 'test',
  sourceUrl: '',
  surveyYear: 2014,
  buildings: { '9999999': TOWER },
  missing: [],
};

describe('the surveyed massing must not leak into the flat map', () => {
  beforeEach(() => {
    resetLod2();
  });

  it('leaves a floor band exactly where it was', () => {
    const before = computeBands(BUILDING as Building, spaceClaims(SPACES));
    ingest(ASSET);
    const after = computeBands(BUILDING as Building, spaceClaims(SPACES));
    expect(after).toEqual(before);
  });

  it('leaves the facade floor lines exactly where they were', () => {
    const before = computeFloorLines(BUILDING as Building);
    ingest(ASSET);
    expect(computeFloorLines(BUILDING as Building)).toEqual(before);
  });

  it('leaves the building ring exactly as it was', () => {
    const before = buildingRing(BUILDING as Building);
    ingest(ASSET);
    expect(buildingRing(BUILDING as Building)).toEqual(before);
  });

  it('but DOES change the Explore-only collar, which is the whole point', () => {
    // Same building, same floor, same collar radius. Without the surveyed
    // massing the collar is the plot; with it, the shaft. If this ever stops
    // differing, either §5 has been reverted or this test has stopped
    // testing anything.
    const floorFt = (200 / 0.3048) / 50;
    const plain = bandRingAt(BUILDING as Building, 39 * floorFt, 1.035);
    ingest(ASSET);
    const surveyed = bandRingAt(BUILDING as Building, 39 * floorFt, 1.035);

    expect(plain).not.toBeNull();
    expect(surveyed).not.toBeNull();
    expect(surveyed).not.toEqual(plain);
  });

  it('and reverts the moment the massing is unloaded', () => {
    const floorFt = (200 / 0.3048) / 50;
    const plain = bandRingAt(BUILDING as Building, 39 * floorFt, 1.035);
    ingest(ASSET);
    resetLod2();
    expect(bandRingAt(BUILDING as Building, 39 * floorFt, 1.035)).toEqual(plain);
  });
});
