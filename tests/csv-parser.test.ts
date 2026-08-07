import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseAgentEmail,
  parseAskingRent,
  parseAvailabilityCsv,
  parseDateAdded,
  parseFloor,
  parseOccupancy,
  parseSf,
  parseTerm,
  splitAddressAndName,
} from '@/lib/csv-parser';

const sample = (name: string) =>
  readFileSync(join(process.cwd(), 'data', 'samples', name), 'utf8');

const TODAY = new Date('2025-06-20T00:00:00Z');

describe('field parsers', () => {
  it('splits a building name off the address', () => {
    expect(splitAddressAndName('60 E 42nd Street - One Grand Central Place')).toEqual({
      address: '60 E 42nd Street',
      name: 'One Grand Central Place',
    });
    expect(splitAddressAndName('200 Park Avenue - MetLife Building')).toEqual({
      address: '200 Park Avenue',
      name: 'MetLife Building',
    });
  });

  it('leaves hyphenated address ranges intact', () => {
    expect(splitAddressAndName('22-30 Little W 12th Street').address).toBe(
      '22-30 Little W 12th Street',
    );
    expect(splitAddressAndName('24-32 Union Sq E').address).toBe('24-32 Union Sq E');
    expect(splitAddressAndName('20-28 W 33rd Street').name).toBeNull();
  });

  it('reads floor label, number and portion', () => {
    expect(parseFloor('Entire 8th')).toMatchObject({ portion: 'entire', number: 8 });
    expect(parseFloor('Partial 45th')).toMatchObject({ portion: 'partial', number: 45 });
    expect(parseFloor('Entire 1st')).toMatchObject({ portion: 'entire', number: 1 });
    expect(parseFloor('Partial 11th')).toMatchObject({ portion: 'partial', number: 11 });
  });

  it('strips comma separators from square footage', () => {
    expect(parseSf('"24,710"')).toBe(24710);
    expect(parseSf('7,100')).toBe(7100);
    expect(parseSf('50,891')).toBe(50891);
    expect(parseSf('')).toBeNull();
  });

  it('treats Withheld as unknown, never as zero', () => {
    expect(parseAskingRent(' $ 52.00 ')).toEqual({ psf: 52, withheld: false });
    expect(parseAskingRent(' $ 118.00 ')).toEqual({ psf: 118, withheld: false });
    expect(parseAskingRent(' Withheld ')).toEqual({ psf: null, withheld: true });
    expect(parseAskingRent('')).toEqual({ psf: null, withheld: true });
  });

  it('parses the date added', () => {
    expect(parseDateAdded('06/13/2025')).toBe('2025-06-13');
    expect(parseDateAdded('06/18/2025')).toBe('2025-06-18');
    expect(parseDateAdded('nonsense')).toBeNull();
  });

  it('turns occupancy into an available-from date', () => {
    expect(parseOccupancy('Vacant', TODAY)).toBe('2025-06-20');
    expect(parseOccupancy('30 Days', TODAY)).toBe('2025-07-20');
    expect(parseOccupancy('Sep 2025', TODAY)).toBe('2025-09-01');
    expect(parseOccupancy('Jul 2026', TODAY)).toBe('2026-07-01');
    expect(parseOccupancy('Feb 2026', TODAY)).toBe('2026-02-01');
  });

  it('turns a Thru term into a lease expiration', () => {
    expect(parseTerm('Thru Mar 2033')).toBe('2033-03-31');
    expect(parseTerm('Thru Feb 2030')).toBe('2030-02-28');
    expect(parseTerm('Thru Jun 2027')).toBe('2027-06-30');
    expect(parseTerm('Thru Aug 2036')).toBe('2036-08-31');
  });

  it('does not invent an expiration for open-ended terms', () => {
    expect(parseTerm('Negotiable')).toBeNull();
    expect(parseTerm('5 - 10 Years')).toBeNull();
    expect(parseTerm('1 - 10 Years')).toBeNull();
  });

  it('flags emails truncated by the source sheet', () => {
    expect(parseAgentEmail('bcohn@adamsre.com').suspect).toBe(false);
    expect(parseAgentEmail('mac.roos@colliers.com').suspect).toBe(false);
    expect(parseAgentEmail('ethan.silverstein@cushwak').suspect).toBe(true);
    expect(parseAgentEmail('michaelh@kaufmanorganization.').suspect).toBe(true);
    expect(parseAgentEmail('Ron.LoRusso@cushwake.co').suspect).toBe(true);
    expect(parseAgentEmail('sevans@platinumpropertiesn').suspect).toBe(true);
  });
});

describe('Midtown South sheet', () => {
  const result = parseAvailabilityCsv(sample('space-added-midtown-south.csv'), TODAY);

  it('reads the market label off row 1', () => {
    expect(result.marketLabel).toBe('Midtown South');
  });

  it('parses without errors', () => {
    expect(result.errors).toEqual([]);
  });

  it('collapses the duplicated 118 W 22nd Street row', () => {
    expect(result.duplicatesRemoved).toBe(1);
    const w22 = result.rows.filter((r) => r.addressDisplay === '118 W 22nd Street');
    expect(w22).toHaveLength(1);
  });

  it('keeps every remaining listing', () => {
    // 15 data rows, one of which is a duplicate.
    expect(result.rows).toHaveLength(14);
  });

  it('reads a fully specified listing correctly', () => {
    const row = result.rows.find(
      (r) => r.addressDisplay === '102 Madison Avenue',
    )!;
    expect(row).toMatchObject({
      floorNumber: 11,
      floorPortion: 'partial',
      sf: 11012,
      askingRentPsf: 52,
      askingRentWithheld: false,
      leaseType: 'direct',
      buildingClass: 'C',
      submarket: 'Midtown South',
      submarketCluster: 'Gramercy Park',
      agentName: 'Brad Cohn',
      dateAdded: '2025-06-13',
    });
  });

  it('reads a sublet with a hard expiration', () => {
    const row = result.rows.find(
      (r) => r.addressDisplay === '512 W 22nd Street',
    )!;
    expect(row.leaseType).toBe('sublet');
    expect(row.availableFrom).toBe('2025-09-01');
    expect(row.termExpires).toBe('2027-06-30');
    expect(row.askingRentWithheld).toBe(true);
  });

  it('flags an address with no street number for manual matching', () => {
    const row = result.rows.find((r) => r.addressDisplay === 'One Soho Sq')!;
    expect(row.warnings.some((w) => w.includes('no street number'))).toBe(true);
    expect(row.sf).toBe(27344);
    expect(row.askingRentPsf).toBe(68);
  });

  it('keeps all three Union Sq floors as separate listings', () => {
    const union = result.rows.filter((r) => r.addressDisplay === '24-32 Union Sq E');
    expect(union.map((r) => r.floorNumber).sort()).toEqual([4, 5, 6]);
    expect(union.every((r) => r.termExpires === '2030-02-28')).toBe(true);
  });
});

describe('Midtown sheet', () => {
  const result = parseAvailabilityCsv(sample('space-added-midtown.csv'), TODAY);

  it('reads the market label, trimming trailing whitespace', () => {
    expect(result.marketLabel).toBe('Midtown');
  });

  it('parses without errors', () => {
    expect(result.errors).toEqual([]);
  });

  it('keeps all 29 listings', () => {
    expect(result.rows).toHaveLength(29);
  });

  it('keeps all ten 509 Fifth Avenue floors', () => {
    const rows = result.rows.filter((r) => r.addressDisplay === '509 Fifth Avenue');
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.floorNumber)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rows.every((r) => r.askingRentPsf === 59)).toBe(true);
    // The same building mixes Office, Off/Ret and Off/Med across floors.
    expect(new Set(rows.map((r) => r.spaceUse))).toEqual(
      new Set(['Office', 'Off/Ret', 'Off/Med']),
    );
  });

  it('splits the building name off One Grand Central Place', () => {
    const row = result.rows.find((r) => r.buildingName === 'One Grand Central Place')!;
    expect(row.addressDisplay).toBe('60 E 42nd Street');
    expect(row.floorNumber).toBe(45);
    expect(row.termExpires).toBe('2033-03-31');
  });

  it('reads the most expensive listing in the sheet', () => {
    const row = result.rows.find((r) => r.buildingName === 'MetLife Building')!;
    expect(row.addressDisplay).toBe('200 Park Avenue');
    expect(row.askingRentPsf).toBe(118);
    expect(row.sf).toBe(36184);
    expect(row.floorNumber).toBe(16);
    expect(row.termExpires).toBe('2036-08-31');
  });

  it('handles a 30-day occupancy', () => {
    const row = result.rows.find((r) => r.buildingName === 'The Art of American Building')!;
    expect(row.addressDisplay).toBe('535 Madison Avenue');
    expect(row.availableFrom).toBe('2025-07-20');
    expect(row.termExpires).toBe('2028-12-31');
  });
});

describe('bad input', () => {
  it('refuses a file that is not an availability sheet', () => {
    const result = parseAvailabilityCsv('name,qty\nwidget,3\n');
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]).toContain('does not look like a Space Added sheet');
  });
});
