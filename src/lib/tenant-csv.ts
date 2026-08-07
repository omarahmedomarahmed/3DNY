import Papa from 'papaparse';

/**
 * Parses the hand-authored tenant sheet — who is currently in a building.
 *
 * Written by us, so it is a plain header-on-row-1 CSV. `Address` and `Company`
 * are required; everything else is optional. The address is matched to a
 * building by the same resolver the availability import uses, so it should be
 * written the same way it appears in the weekly sheet.
 *
 * Template: data/samples/tenants-template.csv
 */

export interface TenantRow {
  address: string;
  companyName: string;
  floors: string | null;
  sf: number | null;
  leaseExpiration: string | null;
  industry: string | null;
  notes: string | null;
}

export interface TenantParseResult {
  rows: TenantRow[];
  errors: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const orNull = (v: string): string | null => (v.length > 0 ? v : null);

const normaliseHeader = (v: string): string =>
  clean(v).toLowerCase().replace(/[^a-z0-9]/g, '');

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `"41,500"` → 41500. Blank or unparseable → null. */
export function parseTenantSf(raw: string): number | null {
  const digits = clean(raw).replace(/[^0-9.]/g, '');
  if (!digits) return null;
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Lease expirations are written two ways in practice:
 *
 *   `03/31/2030`  → `2030-03-31` (exact day, as given)
 *   `Mar 2030`    → `2030-03-31` (last day of that month)
 *
 * A month with no day resolves to the last day of the month, which is what the
 * expiration filter should sort on. Anything else returns null rather than
 * inventing a date.
 */
export function parseLeaseExpiration(raw: string): string | null {
  const value = clean(raw);
  if (!value) return null;

  const numeric = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (numeric) {
    const month = parseInt(numeric[1], 10);
    const day = parseInt(numeric[2], 10);
    let year = parseInt(numeric[3], 10);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > lastDayOfMonth(year, month)) return null;
    return iso(year, month, day);
  }

  // Already ISO — accept it unchanged.
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > lastDayOfMonth(year, month)) return null;
    return value;
  }

  const monthYear = value.toLowerCase().match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (monthYear) {
    const month = MONTHS[monthYear[1]];
    if (!month) return null;
    const year = parseInt(monthYear[2], 10);
    return iso(year, month, lastDayOfMonth(year, month));
  }

  return null;
}

const COLUMNS = {
  address: ['Address', 'Building', 'Building Address'],
  companyName: ['Company', 'Company Name', 'Tenant', 'Tenant Name'],
  floors: ['Floors', 'Floor'],
  sf: ['SF', 'Square Feet', 'Size'],
  leaseExpiration: ['Lease Expiration', 'Lease Expiry', 'Expiration', 'Expiry'],
  industry: ['Industry', 'Sector'],
  notes: ['Notes', 'Note', 'Comments'],
} as const;

type ColumnKey = keyof typeof COLUMNS;

export function parseTenantCsv(text: string): TenantParseResult {
  const errors: string[] = [];

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => clean(h),
  });

  const fields = (parsed.meta.fields ?? []).filter((f) => clean(f).length > 0);
  if (fields.length === 0) {
    return {
      rows: [],
      errors: ['The file has no header row. Expected a header starting with "Address".'],
    };
  }

  const resolved = new Map<ColumnKey, string>();
  for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
    const accepted = COLUMNS[key].map(normaliseHeader);
    const hit = fields.find((f) => accepted.includes(normaliseHeader(f)));
    if (hit) resolved.set(key, hit);
  }

  const missing = (['address', 'companyName'] as ColumnKey[]).filter((k) => !resolved.has(k));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        'Missing required column(s): ' +
          missing.map((k) => COLUMNS[k][0]).join(', ') +
          '. Start from data/samples/tenants-template.csv.',
      ],
    };
  }

  const get = (record: Record<string, string>, key: ColumnKey): string => {
    const header = resolved.get(key);
    return header === undefined ? '' : clean(record[header]);
  };

  const rows: TenantRow[] = [];
  const seen = new Set<string>();

  parsed.data.forEach((record, i) => {
    const rowNumber = i + 2;
    if (!record || typeof record !== 'object') return;

    const address = get(record, 'address');
    const companyName = get(record, 'companyName');

    if (!address || !companyName) {
      const hasContent = Object.values(record).some((v) => clean(v).length > 0);
      if (hasContent) {
        errors.push(
          `Row ${rowNumber}: skipped — ${!address ? 'no address' : 'no company name'}.`,
        );
      }
      return;
    }

    const floors = get(record, 'floors');
    const expirationRaw = get(record, 'leaseExpiration');
    const leaseExpiration = parseLeaseExpiration(expirationRaw);
    if (expirationRaw && leaseExpiration === null) {
      errors.push(
        `Row ${rowNumber}: could not read lease expiration "${expirationRaw}". ` +
          'Use MM/DD/YYYY or "Mar 2030".',
      );
    }

    // Same company on the same floors of the same building is one tenancy.
    const key = `${address.toLowerCase()}|${companyName.toLowerCase()}|${floors.toLowerCase()}`;
    if (seen.has(key)) {
      errors.push(`Row ${rowNumber}: duplicate of an earlier row — skipped.`);
      return;
    }
    seen.add(key);

    rows.push({
      address,
      companyName,
      floors: orNull(floors),
      sf: parseTenantSf(get(record, 'sf')),
      leaseExpiration,
      industry: orNull(get(record, 'industry')),
      notes: orNull(get(record, 'notes')),
    });
  });

  if (rows.length === 0 && errors.length === 0) {
    errors.push('No tenant rows found below the header.');
  }

  return { rows, errors };
}
