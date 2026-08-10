import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DURST_ADDRESSES,
  DURST_SKIPPED,
  LANDLORD_FEEDS,
  listingKey,
  parseDurst,
  parseEsrt,
  parseRudin,
  parseSfRange,
  parseSlGreen,
  slGreenTotalPages,
  toParsedRows,
  type FeedListing,
} from '@/lib/landlord-feeds';
import { spaceOriginNote } from '@/lib/provenance';
import type { Space } from '@/types';

/**
 * These parse real markup, captured from the four landlord sites.
 *
 * The fixtures are trimmed to a handful of records each, and the records were
 * chosen for the things that go wrong rather than the things that go right: a
 * space below street level, a floor number welded to a wing letter, a size
 * given as a range, a building in Brooklyn, a building marketed under a name
 * instead of a number.
 *
 * The failure that actually matters is silent. These are somebody else's
 * templates; when one changes, the parser does not throw, it returns nothing —
 * and an empty parse reads on the map as "this landlord has no space" rather
 * than "this is broken". So the first assertion in every block is that rows
 * came back at all.
 */

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), 'tests/fixtures/landlord', `${name}.html`), 'utf8');

const find = (rows: FeedListing[], label: string) =>
  rows.find((r) => r.floorLabel === label);

describe('SL Green', () => {
  const rows = parseSlGreen(fixture('slgreen'));

  it('reads every row on the page', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.addressDisplay.length > 0)).toBe(true);
  });

  it('keeps the landlord’s own words for the space', () => {
    const suite = find(rows, 'Suite 820');
    expect(suite).toMatchObject({
      addressDisplay: '100 Church Street',
      floorNumber: 8,
      floorPortion: 'partial',
      sf: 4170,
    });

    const full = find(rows, 'Entire 21st Floor');
    expect(full).toMatchObject({ floorNumber: 21, floorPortion: 'entire', sf: 18087 });
  });

  it('never turns a unit number below street level into a floor', () => {
    // "Lower Level Suite 1" carries a 1 that is a unit, not a floor. Reading
    // it as floor 1 would put a Goldenrod band on a leased floor at street
    // level for a space that is under the pavement.
    expect(find(rows, 'Lower Level Suite 1')?.floorNumber).toBeNull();
    expect(find(rows, 'Partial Ground Floor 3')?.floorNumber).toBeNull();
  });

  it('takes the floor from the landlord when the landlord gives one', () => {
    // SL Green publishes data-floor="1" for this ground-floor shop. That is
    // their number, not an inference from the word "Ground", so it is used.
    expect(find(rows, 'Ground Floor')).toMatchObject({ floorNumber: 1, spaceUse: 'Retail' });
  });

  it('carries the asking rent as withheld, because none is published', () => {
    expect(rows.every((r) => r.askingRentWithheld)).toBe(true);
    expect(rows.every((r) => r.askingRentPsf === null)).toBe(true);
  });

  it('reads the page count so the loader knows when to stop', () => {
    expect(slGreenTotalPages(fixture('slgreen'))).toBe(4);
    expect(slGreenTotalPages('<html>no pagination</html>')).toBe(1);
  });
});

describe('Durst', () => {
  const rows = parseDurst(fixture('durst'));

  it('reads every row on the page', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('resolves a building marketed under a name to its street address', () => {
    expect(rows.some((r) => r.addressDisplay === '285 Fulton Street')).toBe(true);
    expect(rows.every((r) => /^\d|^One |^Four /.test(r.addressDisplay))).toBe(true);
  });

  it('skips a listing whose building it cannot place, rather than guessing', () => {
    const slugs = Object.keys(DURST_SKIPPED);
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(DURST_ADDRESSES[slug]).toBeUndefined();
    }
    // The fixture contains a row for one of them and it produces nothing.
    expect(fixture('durst')).toMatch(new RegExp(slugs.join('|'), 'i'));
    expect(rows.length).toBeLessThan(
      (fixture('durst').match(/<td class='sqft'>/g) ?? []).length,
    );
  });

  it('reads a floor number welded to a wing letter', () => {
    // "46C" has no word boundary between the digits and the letter, so the
    // floor parser sees no number at all unless it is loosened first.
    expect(find(rows, 'Partial Floor 46C')?.floorNumber).toBe(46);
    expect(find(rows, 'Partial Floor 71 J')?.floorNumber).toBe(71);
  });

  it('takes the space from a range, not the block it could join', () => {
    // Durst's own comment on this row: "45,951 SF Block if Leased with
    // Penthouse I". The 45,951 belongs to two floors, so charging it to this
    // one would double the building's available SF.
    const ph = find(rows, 'Penthouse II');
    expect(ph?.sf).toBe(12908);
    expect(ph?.notes).toMatch(/contiguous block of up to 45,951 SF/);
    // A penthouse names no numbered floor, so it is recorded and not drawn.
    expect(ph?.floorNumber).toBeNull();
  });

  it('folds Durst Ready into an office rather than a third kind of space', () => {
    const ready = rows.find((r) => /Durst Ready/i.test(r.notes ?? ''));
    expect(ready?.spaceUse).toBe('Office');
  });
});

describe('Rudin', () => {
  const rows = parseRudin(fixture('rudin'));

  it('reads every card on the page', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('reads floor, size and submarket off the card', () => {
    expect(find(rows, 'Partial 36th Floor, Suite 3620')).toMatchObject({
      addressDisplay: '41 Madison Avenue',
      floorNumber: 36,
      floorPortion: 'partial',
      sf: 5087,
      submarket: 'Midtown South',
    });
    expect(find(rows, 'Entire 28th Floor, Suite 2800')?.floorPortion).toBe('entire');
  });

  it('leaves out the portfolio that is not Manhattan office', () => {
    // The fixture carries one of them; none of them comes through.
    expect(fixture('rudin')).toMatch(/Dock 72|Greenwich Lane|945 Fifth|544 East 86/);
    expect(
      rows.some((r) => /Dock 72|Greenwich Lane|945 Fifth|544 East 86/.test(r.addressDisplay)),
    ).toBe(false);
  });
});

describe('Empire State Realty Trust', () => {
  const rows = parseEsrt(fixture('esrt'));

  it('reads every card on the page', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('reads the building name as well as the address', () => {
    expect(find(rows, 'Entire 30th Floor')).toMatchObject({
      addressDisplay: '350 Fifth Avenue',
      buildingName: 'Empire State Building',
      floorNumber: 30,
      sf: 25147,
    });
  });

  it('takes a floor from a four-digit suite', () => {
    // 4300 is not floor 4300 and is not floor 3 either.
    expect(find(rows, 'Suite 4300')?.floorNumber).toBe(43);
  });

  it('leaves out the buildings that are not in Manhattan', () => {
    expect(fixture('esrt')).toMatch(/Brooklyn, NY/);
    expect(rows.length).toBeLessThan(
      (fixture('esrt').match(/availability-card/g) ?? []).length,
    );
  });
});

describe('the same listing, twice', () => {
  it('is one listing', () => {
    const a: FeedListing = {
      addressDisplay: '1133 Avenue of the Americas',
      buildingName: null,
      floorLabel: 'Partial 6',
      floorNumber: 6,
      floorPortion: 'partial',
      sf: 3273,
      askingRentPsf: null,
      askingRentWithheld: true,
      spaceUse: 'Office',
      leaseType: 'direct',
      occupancyRaw: 'Immediate',
      submarket: null,
      notes: 'listed under the building',
    };
    // Durst prints some spaces twice, under the building and under the Durst
    // Ready programme, with different blurbs. It is one floor either way.
    const b: FeedListing = { ...a, notes: 'listed under Durst Ready' };
    expect(listingKey(a)).toBe(listingKey(b));
    expect(listingKey({ ...a, sf: 3274 })).not.toBe(listingKey(a));
  });
});

describe('parseSfRange', () => {
  it('takes the space and records the block it could join', () => {
    expect(parseSfRange('12,908 - 45,951')).toEqual({
      sf: 12908,
      note: 'Part of a contiguous block of up to 45,951 SF',
    });
  });

  it('reads a backwards range the same way round', () => {
    expect(parseSfRange('45,951 - 12,908').sf).toBe(12908);
  });

  it('reads a range whose ends are equal as that one size', () => {
    // Durst publishes "5,728 - 5,728" for a space that is not divisible.
    // Falling through to the plain parser strips the punctuation and returns
    // 57,285,728 — a five-thousand-foot suite as fifty-seven million.
    expect(parseSfRange('5,728 - 5,728')).toEqual({ sf: 5728, note: null });
  });

  it('returns nothing rather than gluing two numbers together', () => {
    // Two sizes with no separator this understands is the dangerous shape:
    // stripping the punctuation would concatenate them into one huge number.
    expect(parseSfRange('12,908 45,951').sf).toBeNull();
    expect(parseSfRange('12,908/45,951').sf).toBeNull();
    // One number with something unreadable after it is still that number.
    expect(parseSfRange('5,728 - approx').sf).toBe(5728);
  });

  it('leaves a single number alone', () => {
    expect(parseSfRange('3,273')).toEqual({ sf: 3273, note: null });
  });

  it('gives up rather than inventing a size', () => {
    expect(parseSfRange('Upon request').sf).toBeNull();
  });
});

describe('as import rows', () => {
  const source = LANDLORD_FEEDS[0];
  const rows = toParsedRows(source, parseSlGreen(fixture('slgreen')));

  it('never stamps a date the landlord did not publish', () => {
    // date_added is part of the spaces natural key. Stamping the run date
    // would both claim the floor came to market today and make every weekly
    // run insert a fresh copy of the entire market.
    expect(rows.every((r) => r.dateAdded === null)).toBe(true);
  });

  it('never guesses the building class', () => {
    // No landlord page states it, and it is a market convention rather than a
    // recorded fact, so it stays empty for someone to fill in.
    expect(rows.every((r) => r.buildingClass === null)).toBe(true);
  });

  it('names the landlord as the listing party and never an individual', () => {
    expect(rows.every((r) => r.leasingCompany === source.landlord)).toBe(true);
    expect(rows.every((r) => r.agentName === null && r.agentEmail === null)).toBe(true);
  });
});

describe('the feeds themselves', () => {
  it('each has a public page a client can be shown', () => {
    for (const feed of LANDLORD_FEEDS) {
      expect(feed.listingUrl).toMatch(/^https:\/\//);
      expect(feed.landlord.length).toBeGreaterThan(0);
      expect(feed.maxPages).toBeGreaterThan(0);
      expect(feed.crawlDelayS).toBeGreaterThan(0);
    }
  });

  it('waits as long as SL Green’s robots.txt asks', () => {
    // slgreen.com publishes Crawl-delay: 10. It is the only one of the four
    // that asks for anything, and a run takes two minutes because of it.
    expect(LANDLORD_FEEDS.find((f) => f.key === 'slgreen')?.crawlDelayS).toBe(10);
  });
});

describe('what the i icon says about a landlord run', () => {
  const base = {
    id: 's1',
    building_id: 'b1',
    source_import_id: 'imp-1',
    import_uploaded_at: '2026-08-10T12:00:00.000Z',
  } as unknown as Space;

  it('calls it the landlord’s listing, and offers the page', () => {
    const note = spaceOriginNote({
      ...base,
      import_filename: 'SL Green Realty Corp. availabilities, 2026-08-10',
      import_source_kind: 'landlord',
      import_source_url: 'https://slgreen.com/availabilities/',
    });
    expect(note.kind).toBe('landlord');
    expect(note.label).toContain('SL Green');
    expect(note.label).toContain('read Aug 10, 2026');
    expect(note.href).toBe('https://slgreen.com/availabilities/');
    // The one thing it must never say.
    expect(note.detail).not.toMatch(/uploaded to this app|compiled the sheet/);
  });

  it('still calls an uploaded sheet a sheet', () => {
    const note = spaceOriginNote({
      ...base,
      import_filename: 'Space Added This Week.csv',
      import_source_kind: 'sheet',
    } as unknown as Space);
    expect(note.kind).toBe('sheet');
    expect(note.label).toContain('imported');
  });

  it('degrades an unknown kind rather than passing it off as a sheet', () => {
    const note = spaceOriginNote({
      ...base,
      import_filename: 'something new',
      import_source_kind: 'costar',
    } as unknown as Space);
    expect(note.kind).toBe('unknown');
    expect(note.label).toMatch(/costar/i);
  });
});
