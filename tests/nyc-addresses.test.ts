import { describe, expect, it } from 'vitest';
import {
  houseNumberCandidates,
  normalizeStreetName,
  splitHouseAndStreet,
} from '../src/lib/nyc-addresses';

/**
 * The fallback geocoder's string handling.
 *
 * All of this exists because the importer had a single point of failure: when
 * NYC Geosearch returned 503, every row of every sheet came back "unmatched"
 * and nothing could be imported at all — including the bundled samples, so a
 * deleted inventory could not be restored.
 *
 * The comparisons below are the whole fallback. If a leasing sheet's spelling
 * of a street and the city's spelling of the same street do not reduce to the
 * same string, the address silently fails to match, which is exactly the
 * failure mode this is here to prevent.
 */

describe('normalizeStreetName', () => {
  it('reduces the sheet spelling and the city spelling to the same string', () => {
    // The city stores this as "W  30 ST" — two spaces, abbreviated, no ordinal.
    const city = normalizeStreetName('W  30 ST');
    expect(normalizeStreetName('W 30th Street')).toBe(city);
    expect(normalizeStreetName('West 30th Street')).toBe(city);
    expect(normalizeStreetName('West 30 Street')).toBe(city);
    expect(normalizeStreetName('w 30th st')).toBe(city);
  });

  it('turns spelled-out avenues into the numbers the city files them under', () => {
    // Without this, every numbered avenue in Midtown failed to resolve —
    // Fifth, Sixth, Seventh and Third are most of the sheet.
    expect(normalizeStreetName('Fifth Avenue')).toBe(normalizeStreetName('5 AVE'));
    expect(normalizeStreetName('Seventh Avenue')).toBe(normalizeStreetName('7 AVE'));
    expect(normalizeStreetName('Third Avenue')).toBe(normalizeStreetName('3 AVE'));
    expect(normalizeStreetName('Twelfth Avenue')).toBe(normalizeStreetName('12 AVE'));
  });

  it('knows the streets with two names', () => {
    expect(normalizeStreetName('Avenue of the Americas')).toBe(normalizeStreetName('6 AVE'));
  });

  it('strips ordinals only where they follow a number', () => {
    // "1ST" as an ordinal and "ST" as a street type must not be confused, or
    // "1st Avenue" and "Avenue Street" collapse together.
    expect(normalizeStreetName('1st Avenue')).toBe('1 AVE');
    expect(normalizeStreetName('E 2nd Street')).toBe('E 2 ST');
    expect(normalizeStreetName('W 3rd Street')).toBe('W 3 ST');
    expect(normalizeStreetName('W 104th Street')).toBe('W 104 ST');
  });

  it('leaves a named street alone apart from casing and spacing', () => {
    expect(normalizeStreetName('Broadway')).toBe('BROADWAY');
    expect(normalizeStreetName('  Madison   Avenue ')).toBe('MADISON AVE');
    expect(normalizeStreetName('Lexington Ave.')).toBe('LEXINGTON AVE');
  });

  it('handles the other street types a Manhattan sheet uses', () => {
    expect(normalizeStreetName('Union Square East')).toBe('UNION SQ E');
    expect(normalizeStreetName('Little W 12th Street')).toBe('LITTLE W 12 ST');
    expect(normalizeStreetName('Astor Place')).toBe('ASTOR PL');
  });

  it('survives empty and junk input rather than throwing', () => {
    expect(normalizeStreetName('')).toBe('');
    expect(normalizeStreetName('   ')).toBe('');
  });
});

describe('splitHouseAndStreet', () => {
  it('splits an ordinary address', () => {
    expect(splitHouseAndStreet('145 W 30th Street')).toEqual({
      house: '145',
      street: 'W 30th Street',
    });
  });

  it('keeps a hyphenated range together', () => {
    expect(splitHouseAndStreet('22-30 Little W 12th Street')).toEqual({
      house: '22-30',
      street: 'Little W 12th Street',
    });
  });

  it('returns null for a building name with no number', () => {
    // "One Soho Sq" is a name, not an address. Saying so honestly sends it to
    // the review queue instead of matching it to something wrong.
    expect(splitHouseAndStreet('One Soho Sq')).toBeNull();
    expect(splitHouseAndStreet('')).toBeNull();
    expect(splitHouseAndStreet('1633')).toBeNull();
  });
});

describe('houseNumberCandidates', () => {
  it('tries the literal range and then each end', () => {
    // The city indexes some ranges under the low number and some under the
    // high, so all three have to be tried.
    expect(houseNumberCandidates('22-30')).toEqual(['22-30', '22', '30']);
  });

  it('leaves a plain number alone', () => {
    expect(houseNumberCandidates('145')).toEqual(['145']);
  });
});
