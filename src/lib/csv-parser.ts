import Papa from 'papaparse';
import type {
  BuildingClass,
  FloorPortion,
  LeaseType,
  ParseResult,
  ParsedRow,
} from '@/types';

/**
 * Parses the weekly "Space Added This Week" sheet exactly as the leasing team
 * produces it. Row 1 is the market label, row 2 is blank, row 3 is the header,
 * data starts on row 4.
 */

const EXPECTED_HEADERS = [
  'Address',
  'Date Added',
  'Floor',
  'SF',
  'Asking Rent',
  'Space Use',
  'Type',
  'Sub-LL',
  // The source sheet misspells this. Match what the team actually sends.
  'Occupany',
  'Term',
  'Leasing Company',
  'Agent',
  'Agent email',
  'Class',
  'Submarket Cluster',
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, ground: 1, lobby: 1, concourse: 0,
  penthouse: -1, ph: -1, mezzanine: 0, cellar: -2, basement: -2,
};

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const orNull = (v: string): string | null => (v.length > 0 ? v : null);

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * `60 E 42nd Street - One Grand Central Place` → address + building name.
 * Only splits on a spaced hyphen, so address ranges like `22-30 Little W 12th`
 * and `24-32 Union Sq E` survive intact.
 */
export function splitAddressAndName(raw: string): {
  address: string;
  name: string | null;
} {
  const value = clean(raw);
  const idx = value.indexOf(' - ');
  if (idx === -1) return { address: value, name: null };
  const address = value.slice(0, idx).trim();
  const name = value.slice(idx + 3).trim();
  if (!address) return { address: value, name: null };
  return { address, name: name || null };
}

/** `Entire 8th` → { portion: 'entire', number: 8 }. `Partial 45th` → 45. */
export function parseFloor(raw: string): {
  portion: FloorPortion;
  number: number | null;
  label: string;
} {
  const label = clean(raw);
  const lower = label.toLowerCase();
  const portion: FloorPortion = lower.startsWith('partial') ? 'partial' : 'entire';

  const numeric = lower.match(/(\d+)\s*(?:st|nd|rd|th)?\b/);
  if (numeric) return { portion, number: parseInt(numeric[1], 10), label };

  for (const [word, value] of Object.entries(ORDINALS)) {
    if (lower.includes(word)) return { portion, number: value, label };
  }
  return { portion, number: null, label };
}

/** `"24,710"` → 24710. Blank or unparseable → null. */
export function parseSf(raw: string): number | null {
  const digits = clean(raw).replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** ` $ 52.00 ` → 52. ` Withheld ` → withheld flag, never zero. */
export function parseAskingRent(raw: string): {
  psf: number | null;
  withheld: boolean;
} {
  const value = clean(raw);
  if (!value) return { psf: null, withheld: true };
  if (/withheld|upon request|negotiable|n\/?a|tbd/i.test(value)) {
    return { psf: null, withheld: true };
  }
  const digits = value.replace(/[^0-9.]/g, '');
  if (!digits) return { psf: null, withheld: true };
  const n = Number.parseFloat(digits);
  if (!Number.isFinite(n) || n <= 0) return { psf: null, withheld: true };
  return { psf: n, withheld: false };
}

/** `06/13/2025` → `2025-06-13`. */
export function parseDateAdded(raw: string): string | null {
  const value = clean(raw);
  const m = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return iso(year, month, day);
}

/**
 * The Occupancy column tells you when the space is actually available.
 * `Vacant` → now. `30 Days` → +30d. `Sep 2025` → first of that month.
 */
export function parseOccupancy(raw: string, today = new Date()): string | null {
  const value = clean(raw);
  if (!value) return null;
  const lower = value.toLowerCase();

  if (lower.includes('vacant') || lower.includes('immediate')) {
    return iso(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate());
  }

  const days = lower.match(/(\d+)\s*days?/);
  if (days) {
    const d = new Date(today.getTime());
    d.setUTCDate(d.getUTCDate() + parseInt(days[1], 10));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  const monthYear = lower.match(/([a-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (monthYear) {
    const month = MONTHS[monthYear[1]];
    if (month) return iso(parseInt(monthYear[2], 10), month, 1);
  }
  return null;
}

/**
 * `Thru Mar 2033` → 2033-03-31, which is what the expiration filter sorts on.
 * `Negotiable` and `5 - 10 Years` carry no date, so they stay null rather than
 * inventing one.
 */
export function parseTerm(raw: string): string | null {
  const value = clean(raw);
  if (!value) return null;
  const m = value
    .toLowerCase()
    .match(/(?:thru|through|until|to)\s+([a-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (!month) return null;
  const year = parseInt(m[2], 10);
  return iso(year, month, lastDayOfMonth(year, month));
}

/**
 * Several agent emails in the source sheets are cut off mid-address
 * (`ethan.silverstein@cushwak`). Flag them rather than showing a partner a
 * contact that will bounce.
 */
export function parseAgentEmail(raw: string): {
  email: string | null;
  suspect: boolean;
} {
  const value = clean(raw).replace(/^"|"$/g, '');
  if (!value) return { email: null, suspect: false };

  const at = value.indexOf('@');
  if (at === -1) return { email: value, suspect: true };

  const domain = value.slice(at + 1);
  //  `cushwak`               → no dot at all
  //  `kaufmanorganization.`  → trailing dot, cut mid-TLD
  //  `cushwake.co`           → `.com` clipped one character short; the same
  //                            sheet carries `cushwake.com` on other rows
  if (!domain.includes('.')) return { email: value, suspect: true };
  if (domain.endsWith('.')) return { email: value, suspect: true };

  const tld = domain.slice(domain.lastIndexOf('.') + 1).toLowerCase();
  const suspect = tld.length < 2 || tld === 'co' || tld === 'ne' || tld === 'or';
  return { email: value, suspect };
}

export function parseLeaseType(raw: string): LeaseType | null {
  const v = clean(raw).toLowerCase();
  if (v.startsWith('sub')) return 'sublet';
  if (v.startsWith('direct')) return 'direct';
  return null;
}

export function parseClass(raw: string): BuildingClass {
  const v = clean(raw).toUpperCase();
  return v === 'A' || v === 'B' || v === 'C' ? v : null;
}

/** Header detection: find the row that actually contains `Address` + `Floor`. */
function findHeaderIndex(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const cells = rows[i].map((c) => clean(c).toLowerCase());
    if (cells.includes('address') && cells.includes('floor')) return i;
  }
  return -1;
}

function findMarketLabel(rows: string[][], headerIndex: number): string | null {
  for (let i = 0; i < headerIndex; i++) {
    const first = clean(rows[i][0]);
    if (first) return first;
  }
  return null;
}

export function parseAvailabilityCsv(
  text: string,
  today = new Date(),
): ParseResult {
  const errors: string[] = [];
  const grid = Papa.parse<string[]>(text, { skipEmptyLines: false }).data;

  const headerIndex = findHeaderIndex(grid);
  if (headerIndex === -1) {
    return {
      marketLabel: null,
      rows: [],
      duplicatesRemoved: 0,
      errors: [
        'Could not find a header row containing "Address" and "Floor". ' +
          'This does not look like a Space Added sheet.',
      ],
    };
  }

  const marketLabel = findMarketLabel(grid, headerIndex);
  const header = grid[headerIndex].map((c) => clean(c));
  const index = new Map<string, number>();
  header.forEach((name, i) => {
    if (name && !index.has(name)) index.set(name, i);
  });

  const missing = EXPECTED_HEADERS.filter((h) => !index.has(h));
  if (missing.length > 0) {
    errors.push(`Missing expected column(s): ${missing.join(', ')}`);
  }

  const get = (row: string[], name: string): string => {
    const i = index.get(name);
    return i === undefined ? '' : clean(row[i]);
  };

  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  let duplicatesRemoved = 0;

  for (let r = headerIndex + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.every((c) => !clean(c))) continue;

    const addressRaw = get(row, 'Address');
    if (!addressRaw) continue;

    const warnings: string[] = [];
    const { address, name } = splitAddressAndName(addressRaw);
    const floor = parseFloor(get(row, 'Floor'));
    const sf = parseSf(get(row, 'SF'));
    const rent = parseAskingRent(get(row, 'Asking Rent'));
    const dateAdded = parseDateAdded(get(row, 'Date Added'));
    const occupancyRaw = orNull(get(row, 'Occupany')) ?? orNull(get(row, 'Occupancy'));
    const termRaw = orNull(get(row, 'Term'));
    const email = parseAgentEmail(get(row, 'Agent email'));

    if (floor.number === null) warnings.push(`Could not read a floor number from "${floor.label}"`);
    if (sf === null) warnings.push('Missing or unreadable square footage');
    if (email.suspect && email.email) warnings.push(`Agent email looks truncated: ${email.email}`);
    if (!/\d/.test(address)) warnings.push('Address has no street number — needs a manual building match');

    // Same building, same floor, same size, same week is one listing.
    const key = `${address.toLowerCase()}|${floor.label.toLowerCase()}|${sf ?? ''}|${dateAdded ?? ''}`;
    if (seen.has(key)) {
      duplicatesRemoved++;
      continue;
    }
    seen.add(key);

    rows.push({
      rowNumber: r + 1,
      addressRaw,
      addressDisplay: address,
      buildingName: name,
      dateAdded,
      floorLabel: floor.label,
      floorNumber: floor.number,
      floorPortion: floor.portion,
      sf,
      askingRentPsf: rent.psf,
      askingRentWithheld: rent.withheld,
      spaceUse: orNull(get(row, 'Space Use')),
      leaseType: parseLeaseType(get(row, 'Type')),
      subLandlord: orNull(get(row, 'Sub-LL')),
      occupancyRaw,
      availableFrom: parseOccupancy(occupancyRaw ?? '', today),
      termRaw,
      termExpires: parseTerm(termRaw ?? ''),
      leasingCompany: orNull(get(row, 'Leasing Company')),
      agentName: orNull(get(row, 'Agent')),
      agentEmail: email.email,
      agentEmailSuspect: email.suspect,
      buildingClass: parseClass(get(row, 'Class')),
      // The sheet's column labels are one concept to the left of their
      // contents: "Submarket Cluster" holds the market (Midtown South) and
      // "Submarket Notes" holds the neighbourhood cluster (Gramercy Park).
      // Map by what the cells actually contain, not by the header wording.
      submarket: orNull(get(row, 'Submarket Cluster')),
      submarketCluster: orNull(get(row, 'Submarket Notes')),
      notes: orNull(get(row, 'Notes')),
      warnings,
    });
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push('No data rows found below the header.');
  }

  return { marketLabel, rows, duplicatesRemoved, errors };
}
