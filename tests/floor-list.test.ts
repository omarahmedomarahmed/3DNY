import { describe, expect, it } from 'vitest';
import { floorFromSuite, formatFloorList, parseFloorList } from '../src/lib/floor-list';

/**
 * This parser decides where a band gets drawn on a tower, so every failure it
 * can have is a band in the wrong place in front of a client. The tests are
 * organised around the two ways that happens: reading a floor that is not
 * there, and missing one that is.
 */

describe('the ordinary ways people write floors', () => {
  const cases: [string, number[]][] = [
    ['14', [14]],
    ['14th', [14]],
    ['12-14', [12, 13, 14]],
    ['12 - 14', [12, 13, 14]],
    ['12–14', [12, 13, 14]],
    ['12 to 14', [12, 13, 14]],
    ['12 thru 14', [12, 13, 14]],
    ['2, 5, 9', [2, 5, 9]],
    ['2 & 5', [2, 5]],
    ['Fl 3-5, 12', [3, 4, 5, 12]],
    ['Floors 3 and 4', [3, 4]],
    ['Entire 8th', [8]],
    ['Partial 45th', [45]],
    ['Third', [3]],
    ['Level 6', [6]],
  ];

  for (const [input, expected] of cases) {
    it(`reads ${JSON.stringify(input)}`, () => {
      expect(parseFloorList(input)).toEqual(expected);
    });
  }

  it('sorts and deduplicates, so a band is never drawn twice', () => {
    expect(parseFloorList('14, 3, 14, 3')).toEqual([3, 14]);
  });
});

describe('what it refuses to guess', () => {
  /**
   * Each of these is a real tenancy that simply has no floor number. The row
   * is still recorded and still shows in the building's tenant table — it is
   * just not drawn, because drawing it would mean inventing a floor.
   */
  for (const named of [
    'Ground',
    'Ground Floor',
    'Lobby',
    'Concourse',
    'Cellar',
    'Lower Level',
    'Mezzanine',
    'PH',
    'Penthouse',
    'Roof',
    'Retail',
  ]) {
    it(`draws nothing for ${JSON.stringify(named)}`, () => {
      expect(parseFloorList(named)).toEqual([]);
    });
  }

  it('does not turn "Entire building" into a guess at floor count', () => {
    expect(parseFloorList('Entire building')).toEqual([]);
  });

  it('handles blank, null and undefined', () => {
    expect(parseFloorList('')).toEqual([]);
    expect(parseFloorList(null)).toEqual([]);
    expect(parseFloorList(undefined)).toEqual([]);
  });

  it('ignores a number no building has', () => {
    // 0, negative, and taller than anything in New York.
    expect(parseFloorList('0')).toEqual([]);
    expect(parseFloorList('250')).toEqual([]);
  });
});

describe('the parses that would put a band somewhere absurd', () => {
  it('does not read a phone number as a range of floors', () => {
    // The failure mode this guards: a stray "212-555" spanning 344 floors.
    expect(parseFloorList('212-555')).toEqual([]);
  });

  it('reads a backwards range the only way it can be meant', () => {
    expect(parseFloorList('14-12')).toEqual([12, 13, 14]);
  });

  it('takes the floor from a suite number when nothing else names one', () => {
    expect(parseFloorList('Suite 402')).toEqual([4]);
    expect(parseFloorList('Ste 1203')).toEqual([12]);
    expect(floorFromSuite('Suite 402')).toBe(4);
  });

  it('does not treat a bare suite number as a floor', () => {
    // "Suite 402" is floor 4. A band on floor 402 would be a tower that does
    // not exist, and the number is right there in the text either way.
    expect(parseFloorList('Suite 402')).not.toContain(402);
  });

  it('lets a stated floor win over a suite number', () => {
    // "3, Suite 402" is one floor, not floors 3 and 4.
    expect(parseFloorList('3, Suite 402')).toEqual([3]);
  });

  it('ignores a two-digit suite, which is a room and not a floor', () => {
    expect(floorFromSuite('Suite 12')).toBeNull();
  });
});

describe('formatFloorList', () => {
  it('collapses a run, because it is the same fact and shorter', () => {
    expect(formatFloorList([12, 13, 14])).toBe('12–14');
  });

  it('keeps separate floors separate', () => {
    expect(formatFloorList([2, 5, 9])).toBe('2, 5, 9');
  });

  it('mixes runs and singles', () => {
    expect(formatFloorList([3, 4, 5, 12])).toBe('3–5, 12');
  });

  it('handles one floor and none', () => {
    expect(formatFloorList([14])).toBe('14');
    expect(formatFloorList([])).toBe('');
  });

  it('survives unsorted, duplicated input', () => {
    expect(formatFloorList([14, 12, 13, 12])).toBe('12–14');
  });
});

describe('round trip', () => {
  it('reads back what it wrote', () => {
    for (const floors of [[14], [12, 13, 14], [2, 5, 9], [3, 4, 5, 12]]) {
      expect(parseFloorList(formatFloorList(floors))).toEqual(floors);
    }
  });
});
