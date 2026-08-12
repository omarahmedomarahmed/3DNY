import type { ReportColumn } from '@/lib/salesforce-reports';
import type { TenantRow } from '@/lib/tenant-csv';
import { parseRelationship, parseTenantSf, parseLeaseExpiration } from '@/lib/tenant-csv';
import { parseFloorList } from '@/lib/floor-list';
import type { BuildingClass, FloorPortion, LeaseType, ParsedRow } from '@/types';

/**
 * Turning somebody else's report columns into our rows.
 *
 * No two Salesforce orgs name anything the same way. Ascendix ships its own
 * managed package with fields like `AscendixRE__Building__r.Name`; a firm that
 * built its own has `Property_Address__c`; the org next door uses standard
 * Account fields. Guessing a fixed schema and hoping is how integrations
 * silently import garbage.
 *
 * So the mapping is **explicit, chosen once, and stored**. The UI suggests it
 * from the column labels — which gets most of it right on a normal Ascendix
 * report — a person confirms it against a live preview of their own rows, and
 * from then on the daily sync uses that mapping and nothing else. When
 * somebody adds a column to the report, the sync keeps working; when somebody
 * renames the one we depend on, the sync says which field went missing rather
 * than importing blanks.
 *
 * Everything here is pure so it can be tested against real column names
 * without an org.
 */

export type FeedKind = 'spaces' | 'occupiers' | 'clients';

export interface FieldDef {
  /** Our key. What `column_map` is keyed on. */
  key: string;
  label: string;
  required?: boolean;
  /** What this is for, shown under the field in the mapping table. */
  hint: string;
  /**
   * Lower-case fragments that suggest a column is this field. Ordered: an
   * earlier match beats a later one, so `Available SF` prefers `sf` over
   * `available`.
   */
  match: string[];
}

/** A space on the market. Maps to the same row the availability CSV produces. */
export const SPACE_FIELDS: FieldDef[] = [
  { key: 'address', label: 'Building address', required: true,
    hint: 'Street address. This is what pins the space to a tower on the map.',
    match: ['property address', 'building address', 'street address', 'address', 'property', 'building'] },
  { key: 'buildingName', label: 'Building name',
    hint: 'Optional. "One Grand Central Place".',
    // `building` and `property` are here last on purpose. A report with both
    // "Building" and "Building Address" is the normal Ascendix shape, and
    // address is resolved first because it is required — so it takes the more
    // specific column and this one gets what is left, which is the name.
    match: ['building name', 'property name', 'building', 'property'] },
  { key: 'floorLabel', label: 'Floor', required: true,
    hint: 'As written — "14", "12-14", "Partial 3", "Ground".',
    match: ['floor', 'level', 'suite/floor'] },
  { key: 'suite', label: 'Suite',
    hint: 'Optional. Appended to the floor label when both are present.',
    match: ['suite', 'unit'] },
  { key: 'sf', label: 'Square feet',
    hint: 'Rentable area of this space.',
    match: ['available sf', 'rentable sf', 'square feet', 'rsf', ' sf', 'sf', 'size', 'area'] },
  { key: 'askingRentPsf', label: 'Asking rent',
    hint: 'Per square foot per year. Blank or "Upon request" reads as withheld.',
    match: ['asking rent', 'asking', 'rent psf', 'rate', 'rent'] },
  { key: 'spaceUse', label: 'Space use',
    hint: 'Office, retail, medical. Free text.',
    match: ['space use', 'use type', 'property type', 'use'] },
  { key: 'leaseType', label: 'Direct or sublet',
    hint: 'Anything containing "sub" reads as a sublet.',
    match: ['lease type', 'direct/sublease', 'sublease', 'transaction type'] },
  { key: 'subLandlord', label: 'Sublandlord',
    hint: 'Only meaningful on a sublet.',
    match: ['sublandlord', 'sublessor'] },
  { key: 'availableFrom', label: 'Available from',
    hint: 'Date the space can be occupied.',
    match: ['date available', 'available date', 'occupancy date', 'available from', 'availability'] },
  { key: 'termExpires', label: 'Term expires',
    hint: 'End of the available term, on a sublet.',
    match: ['term expiration', 'lease expiration', 'expiration', 'term end'] },
  { key: 'leasingCompany', label: 'Listing broker',
    hint: 'The firm, never an individual — this product never shows agent names.',
    match: ['leasing company', 'listing company', 'brokerage', 'leasing firm', 'listing broker'] },
  { key: 'buildingClass', label: 'Building class',
    hint: 'A, B or C.',
    match: ['building class', 'class'] },
  { key: 'submarket', label: 'Submarket',
    hint: 'Midtown, Midtown South, Downtown.',
    match: ['submarket cluster', 'submarket', 'market'] },
  { key: 'notes', label: 'Notes',
    hint: 'Anything worth carrying onto the card.',
    match: ['comments', 'notes', 'description', 'remarks'] },
];

/** A tenancy — an occupier of a building, or one of our own clients. */
export const TENANT_FIELDS: FieldDef[] = [
  { key: 'address', label: 'Building address', required: true,
    hint: 'Street address of the building they occupy.',
    match: ['property address', 'building address', 'street address', 'address', 'property', 'building'] },
  { key: 'companyName', label: 'Company', required: true,
    hint: 'The tenant’s name, as it should read on the card.',
    match: ['account name', 'company name', 'tenant name', 'client name', 'company', 'tenant', 'account'] },
  { key: 'floors', label: 'Floors',
    hint: 'As written — "12-14", "Ground, 2". Drawn as a band on the tower.',
    match: ['floor', 'level'] },
  { key: 'suite', label: 'Suite',
    hint: 'Optional.',
    match: ['suite', 'unit'] },
  { key: 'sf', label: 'Square feet',
    hint: 'How much they occupy.',
    match: ['leased sf', 'occupied sf', 'square feet', 'rsf', ' sf', 'sf', 'size'] },
  { key: 'leaseStart', label: 'Lease start',
    hint: 'Commencement date.',
    match: ['lease start', 'commencement', 'start date', 'lease commencement'] },
  { key: 'leaseExpiration', label: 'Lease expiration',
    hint: 'The most useful fact on a tenant card — it is the reason to call them.',
    match: ['lease expiration', 'lease end', 'expiration date', 'expiration', 'expiry', 'end date'] },
  { key: 'industry', label: 'Industry',
    hint: 'Optional.',
    match: ['industry', 'sector', 'vertical'] },
  { key: 'relationship', label: 'Relationship',
    hint: 'Client, prospect or occupier. Leave unmapped on a single-purpose report — ' +
      'the feed already knows which it is.',
    match: ['relationship', 'account type', 'type', 'status', 'stage'] },
  { key: 'leaseTermMonths', label: 'Term (months)',
    hint: 'Length of the lease. Shown alongside the expiry.',
    match: ['lease term', 'term (months)', 'term months', 'term length', 'term'] },
  { key: 'rentPsf', label: 'Rent',
    hint: 'What they pay, per square foot per year.',
    match: ['base rent', 'current rent', 'rent psf', 'rent'] },
  { key: 'dealStage', label: 'Deal stage',
    hint: 'Where the opportunity stands — "Renewal", "In market", "Signed".',
    match: ['stage name', 'deal stage', 'stage', 'opportunity status'] },
  { key: 'salesforceId', label: 'Salesforce record id',
    hint: 'Map this and every card gets an "Open in Salesforce" link, and a re-sync ' +
      'updates the record in place instead of creating a second one.',
    match: ['record id', 'account id', 'salesforce id', ' id', 'id'] },
  { key: 'dealNotes', label: 'Deal notes',
    hint: 'Anything about the deal worth showing — renewal option, expansion right.',
    match: ['comments', 'notes', 'description', 'remarks', 'deal notes'] },
];

export function fieldsFor(kind: FeedKind): FieldDef[] {
  return kind === 'spaces' ? SPACE_FIELDS : TENANT_FIELDS;
}

// ---------------------------------------------------------------------------
// Suggesting a mapping
// ---------------------------------------------------------------------------

/**
 * A first guess at the mapping, from the column labels.
 *
 * Scored rather than first-match: on a real Ascendix report both "Building" and
 * "Building Address" exist, and picking whichever appeared first would put the
 * building's *name* in the address field and break every match. The longer and
 * earlier-listed fragment wins, one column is used at most once, and required
 * fields are resolved first so they cannot be stolen by an optional one.
 */
export function suggestMapping(
  columns: ReportColumn[],
  kind: FeedKind,
): Record<string, string> {
  const fields = fieldsFor(kind);
  const map: Record<string, string> = {};
  const taken = new Set<string>();

  const score = (column: ReportColumn, field: FieldDef): number => {
    const haystack = `${column.label} ${column.name}`.toLowerCase();
    for (let i = 0; i < field.match.length; i++) {
      const needle = field.match[i];
      if (!haystack.includes(needle)) continue;
      // Earlier fragments are more specific; longer ones matched more of the
      // label. An exact label match beats everything.
      const exact = column.label.trim().toLowerCase() === needle.trim() ? 500 : 0;
      return exact + 100 - i * 10 + needle.trim().length;
    }
    return 0;
  };

  const ordered = [...fields].sort(
    (a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required)),
  );

  for (const field of ordered) {
    let best: { column: string; score: number } | null = null;
    for (const column of columns) {
      if (taken.has(column.name)) continue;
      const s = score(column, field);
      if (s > 0 && (!best || s > best.score)) best = { column: column.name, score: s };
    }
    if (best) {
      map[field.key] = best.column;
      taken.add(best.column);
    }
  }
  return map;
}

/** Required fields a mapping has not filled in. Empty means it is usable. */
export function missingRequired(
  mapping: Record<string, string>,
  kind: FeedKind,
): FieldDef[] {
  return fieldsFor(kind).filter((f) => f.required && !mapping[f.key]?.trim());
}

/** Mapped columns the report no longer has — the "somebody renamed it" case. */
export function staleColumns(
  mapping: Record<string, string>,
  columns: ReportColumn[],
): { field: string; column: string }[] {
  const present = new Set(columns.map((c) => c.name));
  return Object.entries(mapping)
    .filter(([, column]) => column && !present.has(column))
    .map(([field, column]) => ({ field, column }));
}

// ---------------------------------------------------------------------------
// Applying it
// ---------------------------------------------------------------------------

const read = (row: Record<string, string>, mapping: Record<string, string>, key: string) =>
  (mapping[key] ? (row[mapping[key]] ?? '') : '').trim();

/** "Upon request", "Negotiable", "TBD" — a rent that exists but is withheld. */
const WITHHELD = /upon\s*request|negotiable|call|inquir|tbd|n\/?a|withheld/i;

function parseRent(raw: string): { psf: number | null; withheld: boolean } {
  const value = raw.trim();
  if (!value) return { psf: null, withheld: false };
  if (WITHHELD.test(value)) return { psf: null, withheld: true };
  const n = Number.parseFloat(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? { psf: n, withheld: false } : { psf: null, withheld: true };
}

function parseClass(raw: string): BuildingClass {
  const m = /\b([ABC])\b/i.exec(raw);
  return (m ? (m[1].toUpperCase() as BuildingClass) : null) as BuildingClass;
}

function parsePortion(floorLabel: string): FloorPortion {
  return /\b(part|partial|portion|suite)\b/i.test(floorLabel) ? 'partial' : 'entire';
}

function parseDate(raw: string): string | null {
  return parseLeaseExpiration(raw);
}

export interface MappedSpaces {
  rows: ParsedRow[];
  skipped: { row: number; reason: string }[];
}

/**
 * Report rows → the same `ParsedRow` the availability CSV parser produces.
 *
 * Converging on that type is the point: the CRM path then shares the address
 * matcher, the floor parser and the upsert with the CSV path, so a fix to any
 * of them reaches both and the less-used path cannot quietly rot.
 */
export function toSpaceRows(
  reportRows: Record<string, string>[],
  mapping: Record<string, string>,
): MappedSpaces {
  const rows: ParsedRow[] = [];
  const skipped: { row: number; reason: string }[] = [];

  reportRows.forEach((raw, i) => {
    const address = read(raw, mapping, 'address').split('\n')[0].trim();
    const suite = read(raw, mapping, 'suite');
    let floorLabel = read(raw, mapping, 'floorLabel');
    if (!floorLabel && suite) floorLabel = suite;
    else if (floorLabel && suite && !floorLabel.toLowerCase().includes(suite.toLowerCase())) {
      floorLabel = `${floorLabel} (${suite})`;
    }

    // Without a building there is nowhere to draw it, and without a floor there
    // is no height to draw it at. Reported rather than dropped silently: a
    // report where every row misses one of these should say so on the first run.
    if (!address || !floorLabel) {
      skipped.push({
        row: i + 1,
        reason: !address ? 'no building address' : `no floor on ${address}`,
      });
      return;
    }

    const rent = parseRent(read(raw, mapping, 'askingRentPsf'));
    const sf = parseTenantSf(read(raw, mapping, 'sf'));
    const floors = parseFloorList(floorLabel);
    const leaseTypeRaw = read(raw, mapping, 'leaseType');

    rows.push({
      rowNumber: i + 1,
      addressRaw: address,
      addressDisplay: address,
      buildingName: read(raw, mapping, 'buildingName') || null,
      dateAdded: null,
      floorLabel,
      floorNumber: floors.length > 0 ? floors[0] : null,
      floorPortion: parsePortion(floorLabel),
      sf,
      askingRentPsf: rent.psf,
      askingRentWithheld: rent.withheld,
      spaceUse: read(raw, mapping, 'spaceUse') || null,
      leaseType: (leaseTypeRaw
        ? /sub/i.test(leaseTypeRaw) ? 'sublet' : 'direct'
        : null) as LeaseType | null,
      subLandlord: read(raw, mapping, 'subLandlord') || null,
      occupancyRaw: read(raw, mapping, 'availableFrom') || null,
      availableFrom: parseDate(read(raw, mapping, 'availableFrom')),
      termRaw: read(raw, mapping, 'termExpires') || null,
      termExpires: parseDate(read(raw, mapping, 'termExpires')),
      leasingCompany: read(raw, mapping, 'leasingCompany') || null,
      // Never mapped, never imported. Individual agent names and emails are
      // not displayed anywhere in this product, so they are not collected.
      agentName: null,
      agentEmail: null,
      agentEmailSuspect: false,
      buildingClass: parseClass(read(raw, mapping, 'buildingClass')),
      submarket: read(raw, mapping, 'submarket') || null,
      submarketCluster: null,
      notes: read(raw, mapping, 'notes') || null,
      warnings: [],
    });
  });

  return { rows, skipped };
}

export interface MappedTenants {
  rows: TenantRow[];
  skipped: { row: number; reason: string }[];
}

export function toTenantRowsFromReport(
  reportRows: Record<string, string>[],
  mapping: Record<string, string>,
  kind: 'occupiers' | 'clients',
  instanceUrl: string,
): MappedTenants {
  const rows: TenantRow[] = [];
  const skipped: { row: number; reason: string }[] = [];
  // A report bound to the clients feed is a report *of clients*; the column is
  // only consulted when the team keeps one mixed report for everybody.
  const fallback = kind === 'clients' ? 'client' : 'occupier';

  reportRows.forEach((raw, i) => {
    const address = read(raw, mapping, 'address').split('\n')[0].trim();
    const companyName = read(raw, mapping, 'companyName');

    if (!address || !companyName) {
      skipped.push({
        row: i + 1,
        reason: !companyName ? 'no company name' : `no address on ${companyName}`,
      });
      return;
    }

    const id = read(raw, mapping, 'salesforceId') || null;
    const termRaw = read(raw, mapping, 'leaseTermMonths');
    const term = Number.parseInt(termRaw.replace(/[^0-9]/g, ''), 10);
    const rent = parseRent(read(raw, mapping, 'rentPsf'));

    rows.push({
      address,
      companyName,
      floors: read(raw, mapping, 'floors') || null,
      suite: read(raw, mapping, 'suite') || null,
      sf: parseTenantSf(read(raw, mapping, 'sf')),
      leaseStart: parseDate(read(raw, mapping, 'leaseStart')),
      leaseExpiration: parseDate(read(raw, mapping, 'leaseExpiration')),
      industry: read(raw, mapping, 'industry') || null,
      notes: read(raw, mapping, 'dealNotes') || null,
      relationship: parseRelationship(read(raw, mapping, 'relationship'), fallback),
      salesforceId: id,
      salesforceUrl: id ? `${instanceUrl.replace(/\/+$/, '')}/${id}` : null,
      // A term of zero is somebody's placeholder, not a lease. Treated as absent
      // rather than drawn as "0 months" on a card in front of a client.
      leaseTermMonths: Number.isFinite(term) && term > 0 ? term : null,
      rentPsf: rent.psf,
      dealStage: read(raw, mapping, 'dealStage') || null,
    });
  });

  return { rows, skipped };
}
