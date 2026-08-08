/**
 * A second way to turn a street address into a building, for when the first
 * one is down.
 *
 * The importer resolved addresses only through NYC Planning's Geosearch. That
 * is the right primary source — it is authoritative and it returns BIN, BBL
 * and coordinates in one call — but it is a single hosted service, and when it
 * returns 503 every row of every sheet lands in the review queue as
 * "unmatched". At that point the product does not degrade, it stops: there is
 * no way to import anything, including the bundled samples, and no way to get
 * a deleted inventory back.
 *
 * This is the fallback. It uses NYC AddressPoint (`uf93-f8nk`) on Socrata —
 * the same free, keyless infrastructure the map's own footprints, streets and
 * parks already come from, so it is up whenever the rest of the map is.
 *
 * The lookup is deliberately shaped to be robust rather than clever: fetch
 * every address point in Manhattan carrying this house number, then compare
 * street names in a normalised form on our side. Building AddressPoint's exact
 * string ourselves would mean matching quirks like the double space in
 * `W  30 ST`, and getting that subtly wrong fails silently.
 */

const ADDRESS_POINTS = 'https://data.cityofnewyork.us/resource/uf93-f8nk.json';
const FOOTPRINTS = 'https://data.cityofnewyork.us/resource/5zhs-2jue.json';

/** Manhattan. This product is Manhattan-only by design. */
const MANHATTAN = '1';

export interface AddressPointMatch {
  bin: string;
  bbl: string | null;
  lon: number;
  lat: number;
  /** The address as the city records it, for the review queue to show. */
  label: string;
}

function headers(): Record<string, string> {
  const token = process.env.NYC_OPEN_DATA_APP_TOKEN;
  return token ? { 'X-App-Token': token } : {};
}

/** Long forms the city abbreviates, longest first so `AVENUE` beats `AVE`. */
const STREET_TYPES: [RegExp, string][] = [
  [/\bSTREET\b/g, 'ST'],
  [/\bAVENUE\b/g, 'AVE'],
  [/\bBOULEVARD\b/g, 'BLVD'],
  [/\bPARKWAY\b/g, 'PKWY'],
  [/\bTERRACE\b/g, 'TER'],
  [/\bPLACE\b/g, 'PL'],
  [/\bSQUARE\b/g, 'SQ'],
  [/\bDRIVE\b/g, 'DR'],
  [/\bROAD\b/g, 'RD'],
  [/\bLANE\b/g, 'LN'],
  [/\bCOURT\b/g, 'CT'],
];

const DIRECTIONS: [RegExp, string][] = [
  [/\bWEST\b/g, 'W'],
  [/\bEAST\b/g, 'E'],
  [/\bNORTH\b/g, 'N'],
  [/\bSOUTH\b/g, 'S'],
];

/**
 * Spelled-out ordinals, which is how a leasing sheet writes an avenue and is
 * not how the city stores one. `509 Fifth Avenue` lives in AddressPoint as
 * `509 5 AVE`, and without this every numbered avenue in Midtown — Fifth,
 * Sixth, Seventh, Third, Park-adjacent and all — silently failed to resolve.
 * Twelve is enough: Manhattan runs out of avenues there.
 */
const ORDINAL_WORDS: [RegExp, string][] = [
  [/\bFIRST\b/g, '1'],
  [/\bSECOND\b/g, '2'],
  [/\bTHIRD\b/g, '3'],
  [/\bFOURTH\b/g, '4'],
  [/\bFIFTH\b/g, '5'],
  [/\bSIXTH\b/g, '6'],
  [/\bSEVENTH\b/g, '7'],
  [/\bEIGHTH\b/g, '8'],
  [/\bNINTH\b/g, '9'],
  [/\bTENTH\b/g, '10'],
  [/\bELEVENTH\b/g, '11'],
  [/\bTWELFTH\b/g, '12'],
];

/**
 * Manhattan streets with two names in daily use. A sheet may carry either.
 * Applied before everything else, on the raw uppercased text.
 */
const STREET_ALIASES: [RegExp, string][] = [
  [/\bAVENUE\s+OF\s+THE\s+AMERICAS\b/g, '6 AVENUE'],
  [/\bFASHION\s+AVE(NUE)?\b/g, '7 AVENUE'],
  [/\bPARK\s+AVENUE\s+SOUTH\b/g, 'PARK AVENUE S'],
];

/**
 * Reduces a street name to the form both sides can be compared in.
 *
 * `W 30th Street`, `West 30 Street` and the city's own `W  30 ST` all have to
 * land on the same string. Ordinal suffixes are stripped only where they
 * follow digits — otherwise `1ST` as in "1st Avenue" and `ST` as in "Street"
 * become indistinguishable.
 */
export function normalizeStreetName(raw: string): string {
  let s = ` ${(raw ?? '').toUpperCase().replace(/[.,]/g, ' ')} `;
  for (const [re, to] of STREET_ALIASES) s = s.replace(re, to);
  // Ordinals attached to numbers: 30TH -> 30, 3RD -> 3, 1ST -> 1, 2ND -> 2.
  s = s.replace(/(\d+)(ST|ND|RD|TH)\b/g, '$1');
  for (const [re, to] of ORDINAL_WORDS) s = s.replace(re, to);
  for (const [re, to] of DIRECTIONS) s = s.replace(re, to);
  for (const [re, to] of STREET_TYPES) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Splits `145 W 30th Street` into its house number and its street.
 *
 * Returns null when there is no leading number, which is the honest answer
 * for `One Soho Sq` — a name, not an address, and one only a human can resolve.
 */
export function splitHouseAndStreet(
  address: string,
): { house: string; street: string } | null {
  const m = (address ?? '').trim().match(/^(\d+(?:-\d+)?)\s+(.*)$/);
  if (!m) return null;
  const street = m[2].trim();
  if (!street) return null;
  return { house: m[1], street };
}

/**
 * House numbers to try, in order.
 *
 * A hyphenated range is indexed by the city under one end or the other and
 * occasionally under the literal range, so all three are tried — the same
 * reasoning as `addressCandidates` in the matcher, applied to the number
 * rather than to the whole string.
 */
export function houseNumberCandidates(house: string): string[] {
  const out = [house];
  const range = house.match(/^(\d+)-(\d+)$/);
  if (range) out.push(range[1], range[2]);
  return [...new Set(out)];
}

interface AddressPointRow {
  house_number?: string;
  full_street_name?: string;
  bin?: string;
  the_geom?: { coordinates?: [number, number] };
}

/** A BIN of all zeroes means "no building here". */
function usableBin(bin: string | undefined): string | null {
  if (!bin) return null;
  if (/^0+$/.test(bin)) return null;
  return bin;
}

/** BBL is not on AddressPoint, but the footprint for a BIN carries it. */
async function bblForBin(bin: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(
      `${FOOTPRINTS}?bin=${encodeURIComponent(bin)}&$select=base_bbl&$limit=1`,
      { headers: headers(), signal },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { base_bbl?: string }[];
    const bbl = rows[0]?.base_bbl;
    return typeof bbl === 'string' && bbl.trim() ? bbl.trim() : null;
  } catch {
    // Without a BBL the building still renders; only PLUTO's floor count and
    // year built are missed, and both are recoverable by hand.
    return null;
  }
}

/**
 * Resolves an address through AddressPoint.
 *
 * Returns null when the address genuinely is not there, so the caller can tell
 * "no such address" apart from "the service is down" and say the right thing
 * in the review queue.
 */
export async function lookupAddressPoint(
  address: string,
  opts: { signal?: AbortSignal } = {},
): Promise<AddressPointMatch | null> {
  const parts = splitHouseAndStreet(address);
  if (!parts) return null;

  const wanted = normalizeStreetName(parts.street);
  if (!wanted) return null;

  for (const house of houseNumberCandidates(parts.house)) {
    const url =
      `${ADDRESS_POINTS}?$select=house_number,full_street_name,bin,the_geom` +
      `&$where=boroughcode='${MANHATTAN}' AND house_number='${house.replace(/'/g, '')}'` +
      `&$limit=400`;

    let rows: AddressPointRow[];
    try {
      const res = await fetch(encodeURI(url), { headers: headers(), signal: opts.signal });
      if (!res.ok) throw new Error(`AddressPoint returned ${res.status}`);
      rows = (await res.json()) as AddressPointRow[];
    } catch {
      // Let the caller keep whatever the primary source said.
      return null;
    }

    for (const row of rows) {
      if (normalizeStreetName(row.full_street_name ?? '') !== wanted) continue;
      const bin = usableBin(row.bin);
      const coords = row.the_geom?.coordinates;
      if (!bin || !coords || coords.length !== 2) continue;
      return {
        bin,
        bbl: await bblForBin(bin, opts.signal),
        lon: coords[0],
        lat: coords[1],
        label: `${row.house_number ?? house} ${(row.full_street_name ?? parts.street).replace(/\s+/g, ' ')}, Manhattan, NY`,
      };
    }
  }

  return null;
}
