import { describe, expect, it } from 'vitest';
import {
  houseNumberCandidates,
  normalizeStreetName,
  splitHouseAndStreet,
} from '../src/lib/nyc-addresses';
import { addressCandidates } from '../src/lib/address-matcher';

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

describe('a street with two names lands on one', () => {
  /**
   * The trap this exists for: a broker types "Avenue of the Americas", and the
   * city's record for that same building says "AVE OF THE AMERICAS" while its
   * record for the building next door says "6 AVE". An alias that only matches
   * the spelled-out form fires on what was typed and not on what came back, so
   * the two normalise to different strings and one of the best-known addresses
   * in Manhattan comes back unmatched.
   */
  const groups: [string, string[]][] = [
    ['Sixth Avenue', ['Avenue of the Americas', 'AVE OF THE AMERICAS', 'AVENUE OF THE AMERICAS', '6 Avenue', '6 AVE', '6th Ave']],
    ['Seventh Avenue', ['Fashion Avenue', 'FASHION AVE', '7 Avenue', '7 AVE']],
    ['Park Avenue South', ['Park Avenue South', 'PARK AVE SOUTH', 'Park Ave S']],
    ['Lenox Avenue', ['Malcolm X Blvd', 'MALCOLM X BLVD', 'Lenox Avenue', 'LENOX AVE']],
    ['Eighth Avenue', ['Frederick Douglass Blvd', '8 Avenue', '8 AVE']],
  ];

  for (const [name, spellings] of groups) {
    it(`${name}: every spelling normalises the same`, () => {
      const seen = spellings.map((s) => normalizeStreetName(s));
      expect(new Set(seen).size, `${name} → ${JSON.stringify(seen)}`).toBe(1);
    });
  }

  it('still keeps genuinely different streets apart', () => {
    expect(normalizeStreetName('6 Avenue')).not.toBe(normalizeStreetName('7 Avenue'));
    expect(normalizeStreetName('Park Avenue')).not.toBe(normalizeStreetName('Park Avenue South'));
  });
});

/**
 * The candidate spellings an address is tried under.
 *
 * Manhattan writes its best-known towers as words — One Vanderbilt, One
 * Madison, One Battery Park Plaza — and the city indexes every one of them
 * under the digit. This is not a guess about which building is meant: "One"
 * and "1" are the same house number, and the city confirms the building
 * either way. Without it, a landlord feed that spells the number loses the
 * building entirely.
 */
describe('addressCandidates', () => {
  it('spells a leading number word as a digit', () => {
    expect(addressCandidates('One Battery Park Plaza')).toContain('1 Battery Park Plaza');
    expect(addressCandidates('One Vanderbilt Avenue')).toContain('1 Vanderbilt Avenue');
    expect(addressCandidates('Two Penn Plaza')).toContain('2 Penn Plaza');
  });

  it('keeps the original spelling first', () => {
    expect(addressCandidates('One Madison Avenue')[0]).toBe('One Madison Avenue');
  });

  it('leaves a number word that is part of a street name alone', () => {
    // A street named for a number is not a house number.
    expect(addressCandidates('One Hundred Eleventh Street')).toEqual([
      'One Hundred Eleventh Street',
    ]);
    // And a word that merely starts with one is not a number word at all.
    expect(addressCandidates('Stone Street')).toEqual(['Stone Street']);
  });

  it('still tries both ends of an address range', () => {
    const out = addressCandidates('22-30 Little W 12th Street');
    expect(out).toContain('22 Little W 12th Street');
    expect(out).toContain('30 Little W 12th Street');
  });
});
