import type { LeaseType, ParsedRow } from '@/types';
import { parseAskingRent, parseSf } from '@/lib/csv-parser';
import { parseFloorList } from '@/lib/floor-list';

/**
 * Manhattan availability, read off the pages the landlords publish themselves.
 *
 * This exists because of what is NOT available. There is no open dataset of
 * office availability — the city records who owns a building and how tall it
 * is, and says nothing about which floors are empty. The complete picture is
 * CoStar's, it is licensed, and its terms forbid redistributing it. What is
 * left is the landlords themselves: an owner with an empty floor publishes the
 * floor, the size and a phone number, because that is how the floor gets
 * leased.
 *
 * That makes a landlord page the best public source there is for the two facts
 * this map is built on — which floor, and how big — and a poor one for the
 * third. **Not one of the four sources here quotes an asking rent.** Every
 * listing on all four reads "Upon Request". That is not a gap in this parser;
 * it is how Manhattan office space is marketed, and the honest thing to do
 * with it is carry the withheld flag through and let the map say so, rather
 * than fill the column with a number nobody offered.
 *
 * Three rules, and they are the same three the rest of the app runs on:
 *
 * 1. **Read, never infer.** A field the page does not carry stays null. The
 *    building class is not on any of these pages, so it is null, not guessed
 *    from the address. The date a space came to market is not on any of them
 *    either, so `date_added` is null — stamping today's date would say "new to
 *    the market" about a floor that may have sat empty for two years, and
 *    would make every run insert duplicates besides.
 *
 * 2. **An address that cannot be resolved is skipped and counted.** Several
 *    of these buildings are marketed under a name rather than a number
 *    ("One Five One", "5 Grand Central East"). Those resolve through a table
 *    below, each entry verified against the landlord's own page for that
 *    building. A slug that is not in the table produces no listing at all —
 *    it does not produce a listing at a guessed address.
 *
 * 3. **The parsers are pure.** HTML in, rows out, no network. Every one of
 *    them is tested against a captured copy of the real page, because these
 *    are somebody else's templates and they will change without warning. A
 *    parser that silently starts returning zero rows is the failure mode that
 *    matters, so the loader treats an empty parse as an error.
 */

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

/** Tags out, entities decoded, whitespace collapsed. */
export function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `46C` → `46 C`, so a floor number welded to a wing letter is still a floor
 * number. `parseFloorList` anchors on word boundaries — deliberately, so that
 * a four digit suite is not chopped into a floor — and `46C` has no boundary
 * between the digits and the letter, so it reads as no floor at all.
 */
function loosenFloorText(raw: string): string {
  return raw.replace(/(\d)([A-Za-z])/g, '$1 $2');
}

/**
 * A level that has a name instead of a number.
 *
 * These matter more than they look. "Lower Level Suite 1" and "Partial Ground
 * Floor 3" both carry a digit that is a unit number, and anything hunting for
 * a floor finds it: the first draws a band on the first floor for a space that
 * is under the street, and the second on the third floor for a shop at the
 * front door. Both would be a highlighted band on a floor that is actually
 * occupied — the single worst thing this map can get wrong.
 *
 * So a named level is authoritative and terminal: it means "not a numbered
 * floor", and no later candidate gets to overrule it. The space is still
 * recorded and still listed on the building; it is simply not drawn, which is
 * the same rule `parseFloorList` follows for tenancies.
 */
const NAMED_LEVEL =
  /\b(ground|lobby|lower\s*level|concourse|cellar|sub-?cellar|basement|mezzanine|mezz|penthouse|roof)\b/i;

/** The one floor a single availability sits on, or null. */
function floorOf(...candidates: (string | null | undefined)[]): number | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (NAMED_LEVEL.test(candidate)) return null;
    const floors = parseFloorList(loosenFloorText(candidate));
    if (floors.length > 0) return floors[0];
  }
  return null;
}

/** "Entire"/"Full floor" anywhere in what the landlord wrote. */
function portionOf(...candidates: (string | null | undefined)[]): 'entire' | 'partial' {
  const joined = candidates.filter(Boolean).join(' ').toLowerCase();
  if (/\b(entire|full\s*floor|whole\s*floor)\b/.test(joined)) return 'entire';
  return 'partial';
}

/**
 * `12,908 - 45,951` → 12,908, plus a note about the block.
 *
 * The low number is this space; the high number is the largest contiguous
 * block it can be combined into, across neighbouring floors. Durst's own
 * comments say so outright — "45,951 SF Block if Leased with Penthouse I",
 * "Up to 100k SF Contiguous Block Available".
 *
 * Taking the high end, which is the obvious first guess, is badly wrong: four
 * component floors at 733 Third Avenue each carry the same 100,700 SF block
 * figure, so the building totalled 441,625 SF of availability when barely a
 * quarter of that is actually free. A building's total available SF is a
 * number a broker reads aloud in a meeting, and overstating it by four times
 * is the kind of error that ends a conversation.
 *
 * So the space is the space, and the block potential goes in the notes, where
 * it informs without being summed.
 */
export function parseSfRange(raw: string): { sf: number | null; note: string | null } {
  const value = raw.trim();
  const range = value.match(/^([\d,]+)\s*[-–—]\s*([\d,]+)$/);

  if (range) {
    const lo = parseSf(range[1]);
    const hi = parseSf(range[2]);
    // Anything that looks like a range is resolved here and never falls
    // through. `parseSf` strips punctuation, so handing it "5,728 - 5,728"
    // returns 57,285,728 — a five-thousand-foot suite reported as a fifty-
    // seven-million-foot one, which sailed straight past a total that had
    // looked plausible the run before. A range this cannot read is null.
    if (lo === null || hi === null) return { sf: null, note: null };
    if (lo === hi) return { sf: lo, note: null };
    return {
      sf: Math.min(lo, hi),
      note: `Part of a contiguous block of up to ${Math.max(lo, hi).toLocaleString('en-US')} SF`,
    };
  }

  // A stray second number with no dash between would concatenate the same way.
  if (/\d[\s,]*[-–—/]\s*\d|\d\s+\d/.test(value)) return { sf: null, note: null };

  return { sf: parseSf(value), note: null };
}

/** Splits a document on a repeated opening tag, keeping each record whole. */
function chunks(html: string, opener: RegExp): string[] {
  const starts: number[] = [];
  const re = new RegExp(opener.source, opener.flags.includes('g') ? opener.flags : `${opener.flags}g`);
  for (const m of html.matchAll(re)) starts.push(m.index ?? 0);
  return starts.map((start, i) => html.slice(start, starts[i + 1] ?? html.length));
}

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`${name}=['"]([^'"]*)['"]`, 'i'));
  return m ? decodeEntities(m[1]).trim() || null : null;
};

// ---------------------------------------------------------------------------
// What a parser returns
// ---------------------------------------------------------------------------

export interface FeedListing {
  /** The street address, as the landlord writes it. */
  addressDisplay: string;
  buildingName: string | null;
  floorLabel: string;
  floorNumber: number | null;
  floorPortion: 'entire' | 'partial';
  sf: number | null;
  askingRentPsf: number | null;
  askingRentWithheld: boolean;
  spaceUse: string | null;
  leaseType: LeaseType | null;
  occupancyRaw: string | null;
  submarket: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// SL Green — slgreen.com/availabilities
// ---------------------------------------------------------------------------

/**
 * The cleanest of the four: every figure is already a data attribute on the
 * row, put there so the page's own sort control can read it.
 */
export function parseSlGreen(html: string): FeedListing[] {
  const listings: FeedListing[] = [];

  for (const chunk of chunks(html, /<tr class='spaces__row desktop'/)) {
    const open = chunk.slice(0, chunk.indexOf('>') + 1);
    const address = attr(open, 'data-property');
    if (!address) continue;

    const floorRaw = attr(open, 'data-floor');
    const suite = attr(open, 'data-suite');
    const rent = parseAskingRent(attr(open, 'data-rent') ?? '');

    // "Direct" / "Sublet" is prose in the expandable half of the row rather
    // than an attribute, because the page never sorts on it.
    const sublet = /Direct\/Sublet:<\/p>\s*Sublet/i.test(chunk);
    const comments = chunk.match(/Comments:<\/p>\s*([^<]{1,240})/i);

    // Whatever the landlord wrote is what goes on screen. "Entire 21st Floor"
    // and "820" are both how a space gets referred to on the phone, and
    // rewriting either into house style would put a label in front of a client
    // that does not match the landlord's own listing.
    const namesFloor = suite !== null && /entire|partial|floor|level/i.test(suite);
    const label = namesFloor ? suite : suite ? `Suite ${suite}` : (floorRaw ?? 'Unspecified');

    listings.push({
      addressDisplay: address,
      buildingName: null,
      floorLabel: label,
      floorNumber: floorOf(floorRaw, suite),
      floorPortion: portionOf(suite, floorRaw),
      sf: parseSf(attr(open, 'data-sqft') ?? ''),
      askingRentPsf: rent.psf,
      askingRentWithheld: rent.withheld,
      spaceUse: attr(open, 'data-type'),
      leaseType: sublet ? 'sublet' : 'direct',
      occupancyRaw: attr(open, 'data-occupancy'),
      submarket: null,
      notes: comments ? text(comments[1]) || null : null,
    });
  }

  return listings;
}

/** SL Green paginates and prints the page count, so the loader can stop. */
export function slGreenTotalPages(html: string): number {
  const m = html.match(/class="total_pages">\s*(\d+)\s*</);
  const n = m ? Number.parseInt(m[1], 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// ---------------------------------------------------------------------------
// The Durst Organization — durst.org/availabilities
// ---------------------------------------------------------------------------

/**
 * Which building a Durst slug means.
 *
 * Durst markets several buildings under a name rather than a number, and a
 * name cannot be geocoded. Each of these was read off that building's own page
 * on durst.org; none is from memory. A slug that is not here is skipped, and
 * the loader reports it — an unresolved address is a listing this map does not
 * carry, never a listing placed on a guess.
 */
export const DURST_ADDRESSES: Record<string, string> = {
  '1133-avenue-of-the-americas': '1133 Avenue of the Americas',
  '1155-avenue-of-the-americas': '1155 Avenue of the Americas',
  '825-third-avenue': '825 Third Avenue',
  '114-west-47': '114 West 47th Street',
  '11-grand-central-east': '733 Third Avenue',
  '5-grand-central-east': '655 Third Avenue',
  'one-world-trade-center': '285 Fulton Street',
  // Durst's page for "One Five One" never prints a numbered street address —
  // it calls the building Four Times Square throughout. That is the name the
  // city's address index knows it by too, so it is used verbatim rather than
  // substituting the West 42nd Street number from memory.
  'one-five-one': '4 Times Square',
};

/**
 * Slugs deliberately left out, and why. Kept as code rather than a comment so
 * the loader can tell "we decided against this one" from "we have never seen
 * this one" — the second is a page change worth knowing about.
 */
export const DURST_SKIPPED: Record<string, string> = {
  'historic-front-street': 'a block of eleven small buildings, not one address',
  sven: 'Long Island City, not Manhattan',
  'halletts-point': 'Astoria, not Manhattan',
};

export function parseDurst(html: string): FeedListing[] {
  const listings: FeedListing[] = [];

  for (const chunk of chunks(html, /<tr(?:\s[^>]*)?>/)) {
    const cell = (name: string): string | null => {
      const m = chunk.match(new RegExp(`<td class='${name}'>([\\s\\S]*?)</td>`, 'i'));
      return m ? text(m[1]) || null : null;
    };

    const space = cell('space');
    const sqftCell = cell('sqft');
    if (!space || !sqftCell) continue;

    const href = chunk.match(/href="https:\/\/www\.durst\.org\/properties\/([^/"]+)\/availabilities\//i);
    if (!href) continue;
    const slug = href[1].toLowerCase();
    const address = DURST_ADDRESSES[slug];
    if (!address) continue;

    const { sf, note } = parseSfRange(sqftCell);
    const rent = parseAskingRent(cell('rental') ?? '');
    const type = cell('type');
    const comments = cell('comments');

    // "Durst Ready Office" is Durst's furnished, move-in-ready product. It is
    // an office, and the fact that it comes fitted belongs in the notes rather
    // than in the use, where it would create a third kind of space that the
    // filters do not have.
    const durstReady = /durst\s*ready/i.test(`${type ?? ''} ${space}`);
    const spaceUse = type ? type.replace(/durst\s*ready\s*/i, '').trim() || 'Office' : null;

    listings.push({
      addressDisplay: address,
      buildingName: null,
      floorLabel: space,
      floorNumber: floorOf(space),
      floorPortion: portionOf(space),
      sf,
      askingRentPsf: rent.psf,
      askingRentWithheld: rent.withheld,
      spaceUse,
      leaseType: 'direct',
      occupancyRaw: cell('possession'),
      submarket: null,
      notes:
        [durstReady ? 'Furnished and wired (Durst Ready)' : null, note, comments]
          .filter(Boolean)
          .join('. ') || null,
    });
  }

  return listings;
}

// ---------------------------------------------------------------------------
// Rudin — rudin.com/availability
// ---------------------------------------------------------------------------

/** Rudin's portfolio reaches outside Manhattan; these are not office towers. */
const RUDIN_EXCLUDE = /dock\s*72|greenwich\s*lane|945\s*fifth|544\s*east\s*86/i;

export function parseRudin(html: string): FeedListing[] {
  const listings: FeedListing[] = [];

  for (const chunk of chunks(html, /<article[^>]*class="[^"]*available-listing[^"]*"/)) {
    const title = chunk.match(/class="card__title"><a href="[^"]*">([^<]+)</);
    if (!title) continue;
    const address = text(title[1]);
    if (!address || RUDIN_EXCLUDE.test(address)) continue;

    const pretitle = chunk.match(/class="card__pretitle[^"]*">([\s\S]*?)<\/h3>/);
    const sqft = chunk.match(/class="card__sqft">([\s\S]*?)<\/div>/);
    const hood = chunk.match(/class="card__neighborhood">([\s\S]*?)<\/div>/);
    const when = chunk.match(/class="card__availability">([\s\S]*?)<\/div>/);

    const label = pretitle ? text(pretitle[1]) : null;
    if (!label) continue;

    listings.push({
      addressDisplay: address,
      buildingName: null,
      floorLabel: label,
      floorNumber: floorOf(label),
      floorPortion: portionOf(label),
      sf: sqft ? parseSf(text(sqft[1])) : null,
      askingRentPsf: null,
      // Rudin publishes no rent at all — there is no rent field on the card,
      // so this is withheld rather than absent.
      askingRentWithheld: true,
      spaceUse: 'Office',
      leaseType: 'direct',
      occupancyRaw: when ? text(when[1]).replace(/^Available\s+/i, '') || null : null,
      submarket: hood ? text(hood[1]) || null : null,
      notes: null,
    });
  }

  return listings;
}

// ---------------------------------------------------------------------------
// Empire State Realty Trust — esrtreit.com/availabilities
// ---------------------------------------------------------------------------

/** ESRT holds buildings in Connecticut and Westchester as well as Manhattan. */
const MANHATTAN_CITY = /^new york,\s*ny/i;

export function parseEsrt(html: string): FeedListing[] {
  const listings: FeedListing[] = [];

  for (const chunk of chunks(html, /<div class="availability-card">/)) {
    // Three <p class="address"> in order: street, floor, city. The middle one
    // is the only place the floor appears, so a card missing it is a card this
    // map cannot place on a tower.
    const lines = [...chunk.matchAll(/<p class="address">([\s\S]*?)<\/p>/g)]
      .map((m) => text(m[1]))
      .filter(Boolean);
    if (lines.length < 3) continue;

    const [address, floorText, city] = lines;
    if (!MANHATTAN_CITY.test(city)) continue;

    const name = chunk.match(/<h3>\s*<a href="[^"]*">([\s\S]*?)<\/a>/);
    const sqft = chunk.match(/<p class="sq-ft">([\s\S]*?)<\/p>/);
    const grid = new Map<string, string>();
    for (const m of chunk.matchAll(
      /<p class="more-info-label">([\s\S]*?)<\/p>\s*<p class="more-info-text">([\s\S]*?)<\/p>/g,
    )) {
      grid.set(text(m[1]).toLowerCase(), text(m[2]));
    }

    const floorType = grid.get('floor type') ?? null;

    listings.push({
      addressDisplay: address,
      buildingName: name ? text(name[1]) || null : null,
      floorLabel: floorText,
      floorNumber: floorOf(floorText),
      floorPortion: portionOf(floorText, floorType),
      sf: sqft ? parseSf(text(sqft[1])) : null,
      askingRentPsf: null,
      askingRentWithheld: true,
      spaceUse: 'Office',
      leaseType: 'direct',
      occupancyRaw: grid.get('availability') ?? null,
      submarket: null,
      notes: grid.get('condition') ? `Condition: ${grid.get('condition')}` : null,
    });
  }

  return listings;
}

// ---------------------------------------------------------------------------
// The feeds
// ---------------------------------------------------------------------------

/**
 * What makes two listings the same listing.
 *
 * Durst prints some spaces twice — once under the building, once under the
 * Durst Ready programme — and a paginated feed that ignores its page
 * parameter would serve page one forever. Both look identical from here, and
 * both would put the same floor on the map twice. Address, floor and size,
 * because that is the same triple the database's own natural key uses.
 */
export function listingKey(listing: FeedListing): string {
  return [listing.addressDisplay, listing.floorLabel, listing.sf ?? ''].join('|').toLowerCase();
}

export interface FeedSource {
  key: string;
  /** The name that goes in the "i" popover and the leasing-company column. */
  landlord: string;
  homepage: string;
  /** The public page the numbers are read off — shown in the popover. */
  listingUrl: string;
  /** Page `n`, zero-based. Single-page feeds ignore `n`. */
  pageUrl(n: number): string;
  /** A ceiling, so a template change cannot turn the loader into a crawler. */
  maxPages: number;
  /** Seconds between requests. From each site's robots.txt, or 2 by default. */
  crawlDelayS: number;
  parse(html: string): FeedListing[];
  /** Total pages, when the page prints it. Otherwise stop on an empty parse. */
  totalPages?(html: string): number;
}

export const LANDLORD_FEEDS: FeedSource[] = [
  {
    key: 'slgreen',
    landlord: 'SL Green Realty Corp.',
    homepage: 'https://slgreen.com',
    listingUrl: 'https://slgreen.com/availabilities/',
    pageUrl: (n) => `https://slgreen.com/availabilities?sortValue=property&pg=${n + 1}`,
    maxPages: 25,
    // slgreen.com/robots.txt asks for ten seconds between requests. It is the
    // only one of the four that asks for anything, and it gets it.
    crawlDelayS: 10,
    parse: parseSlGreen,
    totalPages: slGreenTotalPages,
  },
  {
    key: 'rudin',
    landlord: 'Rudin Management Company',
    homepage: 'https://rudin.com',
    listingUrl: 'https://rudin.com/availability',
    pageUrl: (n) => `https://rudin.com/availability?page=${n}`,
    maxPages: 40,
    // Rudin's robots.txt asks for nothing, and their server does. Six listings
    // a page over eleven pages, run a few times in an afternoon at two seconds
    // apart, and they started returning 503 and then resetting the connection
    // outright. Nothing here is worth being a nuisance over: fifteen seconds,
    // and a run that takes three minutes instead of twenty seconds.
    crawlDelayS: 15,
    parse: parseRudin,
  },
  {
    key: 'durst',
    landlord: 'The Durst Organization',
    homepage: 'https://www.durst.org',
    listingUrl: 'https://www.durst.org/availabilities',
    pageUrl: () => 'https://www.durst.org/availabilities',
    maxPages: 1,
    crawlDelayS: 2,
    parse: parseDurst,
  },
  {
    key: 'esrt',
    landlord: 'Empire State Realty Trust',
    homepage: 'https://www.esrtreit.com',
    listingUrl: 'https://www.esrtreit.com/availabilities',
    pageUrl: () => 'https://www.esrtreit.com/availabilities',
    maxPages: 1,
    crawlDelayS: 2,
    parse: parseEsrt,
  },
];

// ---------------------------------------------------------------------------
// Into the shape the importer already knows
// ---------------------------------------------------------------------------

/**
 * A feed listing as an import row.
 *
 * Everything downstream — address matching, building creation, PLUTO and
 * footprint enrichment, the natural key that makes a re-run an update rather
 * than a duplicate — already exists for the weekly sheet. This is the whole
 * adapter: the feed becomes rows of exactly the shape the importer takes, and
 * nothing else in the pipeline needs to know where they came from.
 *
 * `dateAdded` is null on purpose, and it is the one field worth arguing about.
 * The natural key includes it, so stamping the run date would make every
 * weekly run insert a fresh copy of every floor; and none of these pages says
 * when a space came to market, so the date would be an invention on top of
 * that. Null says what is true: nobody published it.
 */
export function toParsedRows(source: FeedSource, listings: FeedListing[]): ParsedRow[] {
  return listings.map((listing, i) => ({
    rowNumber: i + 1,
    addressRaw: listing.addressDisplay,
    addressDisplay: listing.addressDisplay,
    buildingName: listing.buildingName,
    dateAdded: null,
    floorLabel: listing.floorLabel,
    floorNumber: listing.floorNumber,
    floorPortion: listing.floorPortion,
    sf: listing.sf,
    askingRentPsf: listing.askingRentPsf,
    askingRentWithheld: listing.askingRentWithheld,
    spaceUse: listing.spaceUse,
    leaseType: listing.leaseType,
    subLandlord: null,
    occupancyRaw: listing.occupancyRaw,
    availableFrom: null,
    termRaw: null,
    termExpires: null,
    // These landlords lease their own buildings in-house, so the landlord is
    // the listing party. It is never an individual — the product does not show
    // individual agents anywhere, and a feed is not going to be the exception.
    leasingCompany: source.landlord,
    agentName: null,
    agentEmail: null,
    agentEmailSuspect: false,
    buildingClass: null,
    submarket: listing.submarket,
    submarketCluster: null,
    notes: listing.notes,
    warnings: [],
  }));
}
