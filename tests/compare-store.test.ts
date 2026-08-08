import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from '../src/lib/store';
import type { BuildingWithSpaces } from '../src/types';

/**
 * The compare set's lifecycle, which is the specific thing this feature has
 * been asked to get right: **dismissing the panel must not empty it**.
 *
 * These assert on the compare set itself rather than on anything rendered,
 * because the failure being guarded against is precisely a close path that
 * quietly also clears — which any test that only checked "is the panel gone"
 * would pass straight through.
 */

function space(id: string, buildingId: string) {
  return {
    id,
    building_id: buildingId,
    floor_number: 14,
    floor_label: '14th',
    floor_portion: 'entire',
    sf: 10000,
    asking_rent_psf: 75,
    asking_rent_withheld: false,
    is_active: true,
  } as unknown as BuildingWithSpaces['spaces'][number];
}

function building(id: string, spaceIds: string[]): BuildingWithSpaces {
  return {
    id,
    address_display: `${id} Test Avenue`,
    spaces: spaceIds.map((s) => space(s, id)),
  } as unknown as BuildingWithSpaces;
}

const BUILDINGS = [building('b1', ['s1', 's2']), building('b2', ['s3'])];

beforeEach(() => {
  useApp.setState({ buildings: BUILDINGS, compare: [], compareOpen: false });
});

describe('adding to the comparison', () => {
  it('adds a space and opens the panel', () => {
    useApp.getState().addToCompare('s1', 'b1');
    expect(useApp.getState().compare).toEqual([{ spaceId: 's1', buildingId: 'b1' }]);
    expect(useApp.getState().compareOpen).toBe(true);
  });

  it('never adds the same space twice', () => {
    useApp.getState().addToCompare('s1', 'b1');
    useApp.getState().addToCompare('s1', 'b1');
    expect(useApp.getState().compare).toHaveLength(1);
  });

  it('keeps the order spaces were added in', () => {
    useApp.getState().addToCompare('s3', 'b2');
    useApp.getState().addToCompare('s1', 'b1');
    expect(useApp.getState().compare.map((c) => c.spaceId)).toEqual(['s3', 's1']);
  });
});

describe('closing the panel', () => {
  it('does NOT empty the comparison', () => {
    const s = useApp.getState();
    s.addToCompare('s1', 'b1');
    s.addToCompare('s3', 'b2');

    useApp.getState().setCompareOpen(false);

    expect(useApp.getState().compareOpen).toBe(false);
    // The whole point: the spaces survive being dismissed.
    expect(useApp.getState().compare).toEqual([
      { spaceId: 's1', buildingId: 'b1' },
      { spaceId: 's3', buildingId: 'b2' },
    ]);
  });

  it('reopens with exactly the same spaces still in it', () => {
    const s = useApp.getState();
    s.addToCompare('s1', 'b1');
    s.addToCompare('s3', 'b2');
    const before = useApp.getState().compare;

    useApp.getState().setCompareOpen(false);
    useApp.getState().setCompareOpen(true);

    expect(useApp.getState().compare).toEqual(before);
    expect(useApp.getState().compareOpen).toBe(true);
  });

  it('survives repeated open and close cycles', () => {
    useApp.getState().addToCompare('s1', 'b1');
    for (let i = 0; i < 5; i++) {
      useApp.getState().setCompareOpen(false);
      useApp.getState().setCompareOpen(true);
    }
    expect(useApp.getState().compare).toHaveLength(1);
  });
});

describe('emptying the comparison', () => {
  it('only happens deliberately, through Clear all', () => {
    const s = useApp.getState();
    s.addToCompare('s1', 'b1');
    s.addToCompare('s3', 'b2');

    useApp.getState().clearCompare();

    expect(useApp.getState().compare).toEqual([]);
    expect(useApp.getState().compareOpen).toBe(false);
  });

  it('removes one space and keeps the rest', () => {
    const s = useApp.getState();
    s.addToCompare('s1', 'b1');
    s.addToCompare('s3', 'b2');

    useApp.getState().removeFromCompare('s1');

    expect(useApp.getState().compare).toEqual([{ spaceId: 's3', buildingId: 'b2' }]);
    expect(useApp.getState().compareOpen).toBe(true);
  });

  it('closes when the last space is removed, since there is nothing to show', () => {
    useApp.getState().addToCompare('s1', 'b1');
    useApp.getState().removeFromCompare('s1');
    expect(useApp.getState().compare).toEqual([]);
    expect(useApp.getState().compareOpen).toBe(false);
  });
});

describe('a shared ?compare= link', () => {
  it('resolves space ids against loaded buildings and opens', () => {
    useApp.getState().loadCompareFromUrl(['s3', 's1']);
    expect(useApp.getState().compare).toEqual([
      { spaceId: 's3', buildingId: 'b2' },
      { spaceId: 's1', buildingId: 'b1' },
    ]);
    expect(useApp.getState().compareOpen).toBe(true);
  });

  it('drops ids that no longer exist rather than showing empty columns', () => {
    useApp.getState().loadCompareFromUrl(['s1', 'gone', 's3']);
    expect(useApp.getState().compare.map((c) => c.spaceId)).toEqual(['s1', 's3']);
  });

  it('stays closed when nothing in the link resolves', () => {
    useApp.getState().loadCompareFromUrl(['gone']);
    expect(useApp.getState().compare).toEqual([]);
    expect(useApp.getState().compareOpen).toBe(false);
  });
});
