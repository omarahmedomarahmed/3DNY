import Papa from 'papaparse';

/**
 * Parses the hand-authored landlord sheet.
 *
 * Unlike the weekly availability sheet, this one is written by us, so it is a
 * plain header-on-row-1 CSV. Every column except `Landlord` is optional: a
 * half-filled sheet is still worth importing, because the insights column is
 * the part that matters in a meeting.
 *
 * Template: data/samples/landlords-template.csv
 * Guidance: docs/LANDLORD-SHEET.md
 */

export interface LandlordRow {
  name: string;
  aliases: string[];
  buildingsOwned: number | null;
  portfolioSf: number | null;
  avgAskingRent: number | null;
  amenities: string[];
  notableTenants: string[];
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  insights: string | null;
}

export interface LandlordParseResult {
  rows: LandlordRow[];
  errors: string[];
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const orNull = (v: string): string | null => (v.length > 0 ? v : null);

/** Header lookup that ignores case, spacing and punctuation drift. */
const normaliseHeader = (v: string): string =>
  clean(v).toLowerCase().replace(/[^a-z0-9]/g, '');

/** `"Amenities A; Amenity B ;"` → `['Amenities A', 'Amenity B']`. */
export function splitList(raw: string): string[] {
  return clean(raw)
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** `"1,250,000"` → 1250000. `"$ 72.50 psf"` → 72.5. Blank → null. */
export function parseNumber(raw: string): number | null {
  const digits = clean(raw).replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Same as parseNumber but rounded, for counts and square footage. */
function parseInteger(raw: string): number | null {
  const n = parseNumber(raw);
  return n === null ? null : Math.round(n);
}

/**
 * Column name → the aliases we accept for it. The first entry is the name in
 * the template; the rest cover the ways a spreadsheet tends to get renamed.
 */
const COLUMNS = {
  name: ['Landlord', 'Landlord Name', 'Name', 'Owner'],
  aliases: ['Aliases', 'Alias', 'Also Known As', 'AKA'],
  buildingsOwned: ['Buildings Owned', 'Buildings', 'Building Count'],
  portfolioSf: ['Portfolio SF', 'Portfolio', 'Portfolio Square Feet'],
  avgAskingRent: ['Avg Asking Rent', 'Average Asking Rent', 'Asking Rent'],
  amenities: ['Amenities', 'Amenity'],
  notableTenants: ['Notable Tenants', 'Tenants', 'Key Tenants'],
  contactName: ['Contact Name', 'Contact'],
  contactEmail: ['Contact Email', 'Email'],
  contactPhone: ['Contact Phone', 'Phone', 'Telephone'],
  insights: ['Insights', 'Insight', 'Notes'],
} as const;

type ColumnKey = keyof typeof COLUMNS;

export function parseLandlordCsv(text: string): LandlordParseResult {
  const errors: string[] = [];

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => clean(h),
  });

  const fields = (parsed.meta.fields ?? []).filter((f) => clean(f).length > 0);
  if (fields.length === 0) {
    return { rows: [], errors: ['The file has no header row. Expected a header starting with "Landlord".'] };
  }

  // Map each logical column to whichever header actually appears in the file.
  const resolved = new Map<ColumnKey, string>();
  for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
    const accepted = COLUMNS[key].map(normaliseHeader);
    const hit = fields.find((f) => accepted.includes(normaliseHeader(f)));
    if (hit) resolved.set(key, hit);
  }

  if (!resolved.has('name')) {
    return {
      rows: [],
      errors: [
        'Missing the "Landlord" column. This does not look like a landlord sheet — ' +
          'start from data/samples/landlords-template.csv.',
      ],
    };
  }

  const get = (record: Record<string, string>, key: ColumnKey): string => {
    const header = resolved.get(key);
    return header === undefined ? '' : clean(record[header]);
  };

  const rows: LandlordRow[] = [];
  const seen = new Map<string, number>();

  parsed.data.forEach((record, i) => {
    // Row 1 is the header, so the first data record is spreadsheet row 2.
    const rowNumber = i + 2;
    if (!record || typeof record !== 'object') return;

    const name = get(record, 'name');
    if (!name) {
      const hasContent = Object.values(record).some((v) => clean(v).length > 0);
      if (hasContent) errors.push(`Row ${rowNumber}: skipped — no landlord name.`);
      return;
    }

    const key = name.toLowerCase();
    const firstSeen = seen.get(key);
    if (firstSeen !== undefined) {
      errors.push(
        `Row ${rowNumber}: "${name}" also appears on row ${firstSeen}. ` +
          'The later row wins — merge them in the sheet if that is not what you want.',
      );
      rows.splice(rows.findIndex((r) => r.name.toLowerCase() === key), 1);
    }
    seen.set(key, rowNumber);

    const email = get(record, 'contactEmail');
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
      errors.push(`Row ${rowNumber}: contact email "${email}" does not look complete.`);
    }

    rows.push({
      name,
      aliases: splitList(get(record, 'aliases')),
      buildingsOwned: parseInteger(get(record, 'buildingsOwned')),
      portfolioSf: parseInteger(get(record, 'portfolioSf')),
      avgAskingRent: parseNumber(get(record, 'avgAskingRent')),
      amenities: splitList(get(record, 'amenities')),
      notableTenants: splitList(get(record, 'notableTenants')),
      contactName: orNull(get(record, 'contactName')),
      contactEmail: orNull(email),
      contactPhone: orNull(get(record, 'contactPhone')),
      insights: orNull(get(record, 'insights')),
    });
  });

  if (rows.length === 0 && errors.length === 0) {
    errors.push('No landlord rows found below the header.');
  }

  return { rows, errors };
}
