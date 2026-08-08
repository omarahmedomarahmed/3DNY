import Papa from 'papaparse';
import type { TenantRelationship } from '@/types';

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
  suite: string | null;
  sf: number | null;
  leaseStart: string | null;
  leaseExpiration: string | null;
  industry: string | null;
  notes: string | null;
  relationship: TenantRelationship;
  /** Present on a Salesforce export, so a re-import updates in place. */
  salesforceId: string | null;
  salesforceUrl: string | null;
}

export interface TenantParseResult {
  rows: TenantRow[];
  errors: string[];
  /** True when the sheet carried Salesforce record ids. */
  fromSalesforce: boolean;
}

/**
 * What the sheet is, which decides what its rows are to us.
 *
 * A CRESA client roster and a Salesforce account export are the same shape of
 * data — a company, a building, some floors — and differ only in what the rows
 * mean. Rather than two parsers that drift apart, there is one parser and the
 * caller says which sheet it is holding.
 */
export type TenantSheetKind = 'roster' | 'clients';

const DEFAULT_RELATIONSHIP: Record<TenantSheetKind, TenantRelationship> = {
  roster: 'occupier',
  clients: 'client',
};

/**
 * Reads a relationship out of whatever the CRM called it.
 *
 * Salesforce type and stage names are configured per org, so this matches on
 * intent rather than on an exact vocabulary, and falls back to the sheet's own
 * default rather than guessing. Getting this wrong in the "client" direction
 * would put a teal band on a tower for a company that is not our client, which
 * is the one error here worth being conservative about.
 */
export function parseRelationship(
  raw: string,
  fallback: TenantRelationship,
): TenantRelationship {
  const value = clean(raw).toLowerCase();
  if (!value) return fallback;
  if (/\b(client|customer|won|active\s*client|represented)\b/.test(value)) return 'client';
  if (/\b(prospect|lead|opportunity|target|pipeline|qualified)\b/.test(value)) return 'prospect';
  if (/\b(occupier|tenant|occupant|incumbent|competitor)\b/.test(value)) return 'occupier';
  return fallback;
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

/**
 * Every header either sheet is known to use.
 *
 * The Salesforce spellings sit alongside ours rather than in a second table:
 * an export is a CSV somebody edited on the way here as often as not, and a
 * single list means a file with a mix of both still reads.
 */
const COLUMNS = {
  address: [
    'Address', 'Building', 'Building Address', 'Billing Street', 'Shipping Street',
    'Property Address', 'Site Address',
  ],
  companyName: [
    'Company', 'Company Name', 'Tenant', 'Tenant Name', 'Account Name', 'Account',
    'Client', 'Client Name', 'Name',
  ],
  floors: ['Floors', 'Floor', 'Floor(s)', 'Premises', 'Space'],
  suite: ['Suite', 'Unit', 'Suite Number'],
  sf: ['SF', 'Square Feet', 'Size', 'RSF', 'Rentable SF', 'Square Footage'],
  leaseStart: ['Lease Start', 'Commencement', 'Lease Commencement', 'Start Date'],
  leaseExpiration: [
    'Lease Expiration', 'Lease Expiry', 'Expiration', 'Expiry', 'Lease End',
    'Expiration Date', 'Lease Expiration Date',
  ],
  industry: ['Industry', 'Sector'],
  notes: ['Notes', 'Note', 'Comments', 'Description'],
  relationship: [
    'Relationship', 'Type', 'Account Type', 'Status', 'Stage', 'Record Type',
    'Client Status',
  ],
  salesforceId: [
    'Salesforce ID', 'Account ID', 'Record ID', 'Id', 'ID', '18 Digit ID',
    'Account 18 Digit ID',
  ],
  salesforceUrl: ['Salesforce URL', 'Link', 'Record URL', 'URL'],
} as const;

type ColumnKey = keyof typeof COLUMNS;

export function parseTenantCsv(
  text: string,
  kind: TenantSheetKind = 'roster',
): TenantParseResult {
  const errors: string[] = [];
  const fallbackRelationship = DEFAULT_RELATIONSHIP[kind];

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => clean(h),
  });

  const fields = (parsed.meta.fields ?? []).filter((f) => clean(f).length > 0);
  if (fields.length === 0) {
    return {
      rows: [],
      fromSalesforce: false,
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
      fromSalesforce: false,
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

    const salesforceId = orNull(get(record, 'salesforceId'));

    // A Salesforce id identifies the tenancy on its own. Without one, the same
    // company on the same floors of the same building is one tenancy.
    const key = salesforceId
      ? `sf:${salesforceId}`
      : `${address.toLowerCase()}|${companyName.toLowerCase()}|${floors.toLowerCase()}`;
    if (seen.has(key)) {
      errors.push(`Row ${rowNumber}: duplicate of an earlier row — skipped.`);
      return;
    }
    seen.add(key);

    const startRaw = get(record, 'leaseStart');
    const leaseStart = parseLeaseExpiration(startRaw);
    if (startRaw && leaseStart === null) {
      errors.push(`Row ${rowNumber}: could not read lease start "${startRaw}".`);
    }

    rows.push({
      address,
      companyName,
      floors: orNull(floors),
      suite: orNull(get(record, 'suite')),
      sf: parseTenantSf(get(record, 'sf')),
      leaseStart,
      leaseExpiration,
      industry: orNull(get(record, 'industry')),
      notes: orNull(get(record, 'notes')),
      relationship: parseRelationship(get(record, 'relationship'), fallbackRelationship),
      salesforceId,
      salesforceUrl: orNull(get(record, 'salesforceUrl')),
    });
  });

  if (rows.length === 0 && errors.length === 0) {
    errors.push('No tenant rows found below the header.');
  }

  return { rows, errors, fromSalesforce: rows.some((r) => r.salesforceId !== null) };
}
