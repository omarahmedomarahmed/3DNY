import { describe, it, expect } from 'vitest';
import { columnsFrom, rowsFrom, REPORT_ROW_LIMIT } from '@/lib/salesforce-reports';
import {
  suggestMapping,
  missingRequired,
  staleColumns,
  toSpaceRows,
  toTenantRowsFromReport,
  SPACE_FIELDS,
  TENANT_FIELDS,
} from '@/lib/salesforce-mapping';
import { leaseStanding, monthsBetween } from '@/lib/lease';

/**
 * Column shapes taken from a real Ascendix-style availability report: the
 * managed-package relationship names, and the ambiguous pair ("Building" and
 * "Building Address") that a naive first-match mapper gets wrong.
 */
const AVAILABILITY_COLUMNS = [
  { name: 'AscendixRE__Property__r.Name', label: 'Building', dataType: 'string' },
  { name: 'AscendixRE__Property__r.Address__c', label: 'Building Address', dataType: 'string' },
  { name: 'AscendixRE__Floor__c', label: 'Floor', dataType: 'string' },
  { name: 'AscendixRE__Suite__c', label: 'Suite', dataType: 'string' },
  { name: 'AscendixRE__Available_SF__c', label: 'Available SF', dataType: 'double' },
  { name: 'AscendixRE__Asking_Rent__c', label: 'Asking Rent', dataType: 'currency' },
  { name: 'AscendixRE__Date_Available__c', label: 'Date Available', dataType: 'date' },
  { name: 'AscendixRE__Lease_Type__c', label: 'Lease Type', dataType: 'picklist' },
  { name: 'AscendixRE__Leasing_Company__c', label: 'Leasing Company', dataType: 'string' },
  { name: 'AscendixRE__Comments__c', label: 'Comments', dataType: 'textarea' },
];

describe('reading a report response', () => {
  it('takes columns from the metadata, in the report’s own order', () => {
    const body = {
      reportMetadata: { detailColumns: ['A', 'B'] },
      reportExtendedMetadata: {
        detailColumnInfo: {
          B: { label: 'Bee', dataType: 'string' },
          A: { label: 'Ay', dataType: 'double' },
        },
      },
    };
    expect(columnsFrom(body).map((c) => c.name)).toEqual(['A', 'B']);
    expect(columnsFrom(body)[0].label).toBe('Ay');
  });

  it('falls back to the label map when detailColumns is absent', () => {
    const body = { reportExtendedMetadata: { detailColumnInfo: { X: { label: 'Ex' } } } };
    expect(columnsFrom(body)).toEqual([{ name: 'X', label: 'Ex', dataType: null }]);
  });

  it('reads rows out of a tabular factMap', () => {
    const columns = [
      { name: 'A', label: 'A', dataType: null },
      { name: 'B', label: 'B', dataType: null },
    ];
    const body = {
      factMap: {
        'T!T': {
          rows: [
            { dataCells: [{ label: '350 Fifth Avenue' }, { label: '14' }] },
            { dataCells: [{ label: '100 Park Avenue' }, { label: '7' }] },
          ],
        },
      },
    };
    expect(rowsFrom(body, columns)).toEqual([
      { A: '350 Fifth Avenue', B: '14' },
      { A: '100 Park Avenue', B: '7' },
    ]);
  });

  it('reads a grouped report too, without losing or double-counting rows', () => {
    // A summary report puts detail rows in per-group buckets and leaves the
    // grand total bucket empty. A team that grouped their report by submarket
    // must not silently sync zero rows.
    const columns = [{ name: 'A', label: 'A', dataType: null }];
    const body = {
      factMap: {
        'T!T': { rows: [] },
        '0!T': { rows: [{ dataCells: [{ label: 'Midtown' }] }] },
        '1!T': { rows: [{ dataCells: [{ label: 'Downtown' }] }] },
      },
    };
    expect(rowsFrom(body, columns).map((r) => r.A).sort()).toEqual(['Downtown', 'Midtown']);
  });

  it('treats Salesforce’s "-" placeholder as empty', () => {
    const columns = [{ name: 'A', label: 'A', dataType: null }];
    const body = { factMap: { 'T!T': { rows: [{ dataCells: [{ label: '-' }] }] } } };
    expect(rowsFrom(body, columns)[0].A).toBe('');
  });

  it('prefers the formatted label over the raw value', () => {
    // `value` carries epoch millis and record ids; `label` is what a person
    // sees, and what our parsers were written against.
    const columns = [{ name: 'A', label: 'A', dataType: 'date' }];
    const body = {
      factMap: { 'T!T': { rows: [{ dataCells: [{ label: '5/31/2027', value: 1811808000000 }] }] } },
    };
    expect(rowsFrom(body, columns)[0].A).toBe('5/31/2027');
  });
});

describe('suggesting a mapping', () => {
  const mapping = suggestMapping(AVAILABILITY_COLUMNS, 'spaces');

  it('puts the address in the address field, not the building name', () => {
    // The trap: "Building" appears first and contains the word. Taking the
    // first match would pin every space to a name instead of a street.
    expect(mapping.address).toBe('AscendixRE__Property__r.Address__c');
    expect(mapping.buildingName).toBe('AscendixRE__Property__r.Name');
  });

  it('finds the rest of an Ascendix availability report', () => {
    expect(mapping.floorLabel).toBe('AscendixRE__Floor__c');
    expect(mapping.sf).toBe('AscendixRE__Available_SF__c');
    expect(mapping.askingRentPsf).toBe('AscendixRE__Asking_Rent__c');
    expect(mapping.availableFrom).toBe('AscendixRE__Date_Available__c');
    expect(mapping.leasingCompany).toBe('AscendixRE__Leasing_Company__c');
  });

  it('never assigns one column to two fields', () => {
    const used = Object.values(mapping);
    expect(new Set(used).size).toBe(used.length);
  });

  it('leaves a field unmapped rather than guessing wildly', () => {
    const sparse = suggestMapping(
      [{ name: 'Foo__c', label: 'Widget Count', dataType: 'double' }],
      'spaces',
    );
    expect(sparse.address).toBeUndefined();
  });

  it('maps a tenant report', () => {
    const tenantColumns = [
      { name: 'Account.Name', label: 'Account Name', dataType: 'string' },
      { name: 'Account.BillingStreet', label: 'Billing Street Address', dataType: 'string' },
      { name: 'Floors__c', label: 'Floors', dataType: 'string' },
      { name: 'Lease_Expiration__c', label: 'Lease Expiration', dataType: 'date' },
      { name: 'Leased_SF__c', label: 'Leased SF', dataType: 'double' },
      { name: 'Account.Id', label: 'Account ID', dataType: 'id' },
    ];
    const m = suggestMapping(tenantColumns, 'occupiers');
    expect(m.companyName).toBe('Account.Name');
    expect(m.address).toBe('Account.BillingStreet');
    expect(m.leaseExpiration).toBe('Lease_Expiration__c');
    expect(m.sf).toBe('Leased_SF__c');
  });
});

describe('mapping validity', () => {
  it('reports the required fields that are still blank', () => {
    expect(missingRequired({}, 'spaces').map((f) => f.key).sort()).toEqual([
      'address', 'floorLabel',
    ]);
    expect(missingRequired({}, 'occupiers').map((f) => f.key).sort()).toEqual([
      'address', 'companyName',
    ]);
  });

  it('accepts a mapping that fills the required fields', () => {
    expect(missingRequired({ address: 'A', floorLabel: 'B' }, 'spaces')).toEqual([]);
  });

  it('catches a column that was renamed in Salesforce', () => {
    // The failure this prevents: a sync that runs happily against a renamed
    // column, reads blanks for every address, and retires the whole map.
    const stale = staleColumns(
      { address: 'Gone__c', floorLabel: 'AscendixRE__Floor__c' },
      AVAILABILITY_COLUMNS,
    );
    expect(stale).toEqual([{ field: 'address', column: 'Gone__c' }]);
  });

  it('ignores unmapped fields when looking for stale columns', () => {
    expect(staleColumns({ address: '', sf: '' }, AVAILABILITY_COLUMNS)).toEqual([]);
  });
});

describe('report rows to spaces', () => {
  const mapping = suggestMapping(AVAILABILITY_COLUMNS, 'spaces');
  const row = (over: Record<string, string> = {}) => ({
    'AscendixRE__Property__r.Name': 'One Grand Central Place',
    'AscendixRE__Property__r.Address__c': '60 E 42nd Street',
    'AscendixRE__Floor__c': '14',
    'AscendixRE__Suite__c': '',
    'AscendixRE__Available_SF__c': '12,500',
    'AscendixRE__Asking_Rent__c': '$88.00',
    'AscendixRE__Date_Available__c': '6/1/2026',
    'AscendixRE__Lease_Type__c': 'Direct',
    'AscendixRE__Leasing_Company__c': 'Example Leasing',
    'AscendixRE__Comments__c': 'Built out',
    ...over,
  });

  it('converts a normal row', () => {
    const { rows } = toSpaceRows([row()], mapping);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      addressDisplay: '60 E 42nd Street',
      buildingName: 'One Grand Central Place',
      floorLabel: '14',
      floorNumber: 14,
      sf: 12500,
      askingRentPsf: 88,
      askingRentWithheld: false,
      availableFrom: '2026-06-01',
      leaseType: 'direct',
      leasingCompany: 'Example Leasing',
    });
  });

  it('reads "Upon request" as withheld rather than as no rent at all', () => {
    const { rows } = toSpaceRows(
      [row({ 'AscendixRE__Asking_Rent__c': 'Upon Request' })], mapping);
    expect(rows[0].askingRentPsf).toBeNull();
    expect(rows[0].askingRentWithheld).toBe(true);
  });

  it('reads a sublease', () => {
    const { rows } = toSpaceRows(
      [row({ 'AscendixRE__Lease_Type__c': 'Sublease' })], mapping);
    expect(rows[0].leaseType).toBe('sublet');
  });

  it('folds a suite into the floor label without repeating it', () => {
    const { rows } = toSpaceRows(
      [row({ 'AscendixRE__Suite__c': '1400' })], mapping);
    expect(rows[0].floorLabel).toBe('14 (1400)');

    const same = toSpaceRows(
      [row({ 'AscendixRE__Floor__c': 'Suite 1400', 'AscendixRE__Suite__c': '1400' })], mapping);
    expect(same.rows[0].floorLabel).toBe('Suite 1400');
  });

  it('marks a part floor as partial', () => {
    const { rows } = toSpaceRows(
      [row({ 'AscendixRE__Floor__c': 'Partial 12' })], mapping);
    expect(rows[0].floorPortion).toBe('partial');
  });

  it('skips a row with no address, and says why', () => {
    const { rows, skipped } = toSpaceRows(
      [row({ 'AscendixRE__Property__r.Address__c': '' })], mapping);
    expect(rows).toHaveLength(0);
    expect(skipped[0].reason).toBe('no building address');
  });

  it('skips a row with no floor rather than putting it at ground level', () => {
    const { rows, skipped } = toSpaceRows(
      [row({ 'AscendixRE__Floor__c': '', 'AscendixRE__Suite__c': '' })], mapping);
    expect(rows).toHaveLength(0);
    expect(skipped[0].reason).toContain('no floor');
  });

  it('never carries an agent name or email, whatever the report holds', () => {
    // Individual agent details are not displayed anywhere in this product, so
    // they are not collected either — there is no column that can map to them.
    expect(SPACE_FIELDS.some((f) => /agent/i.test(f.key))).toBe(false);
    const { rows } = toSpaceRows([row()], mapping);
    expect(rows[0].agentName).toBeNull();
    expect(rows[0].agentEmail).toBeNull();
  });

  it('takes only the first line of a multi-line billing address', () => {
    const { rows } = toSpaceRows(
      [row({ 'AscendixRE__Property__r.Address__c': '60 E 42nd Street\nNew York, NY 10165' })],
      mapping,
    );
    expect(rows[0].addressDisplay).toBe('60 E 42nd Street');
  });
});

describe('report rows to tenancies', () => {
  const mapping = {
    address: 'Street', companyName: 'Company', floors: 'Floors',
    sf: 'SF', leaseExpiration: 'Expires', leaseStart: 'Starts',
    leaseTermMonths: 'Term', rentPsf: 'Rent', dealStage: 'Stage',
    salesforceId: 'Id', relationship: 'Type',
  };
  const row = (over: Record<string, string> = {}) => ({
    Street: '350 Fifth Avenue', Company: 'Example Co', Floors: '12-14',
    SF: '40,000', Expires: '5/31/2029', Starts: '6/1/2019',
    Term: '120', Rent: '$92.50', Stage: 'Renewal', Id: '001XX000003DHPh',
    Type: '', ...over,
  });

  it('converts a tenancy with its deal facts', () => {
    const { rows } = toTenantRowsFromReport([row()], mapping, 'occupiers', 'https://x.my.salesforce.com');
    expect(rows[0]).toMatchObject({
      address: '350 Fifth Avenue',
      companyName: 'Example Co',
      floors: '12-14',
      sf: 40000,
      leaseExpiration: '2029-05-31',
      leaseStart: '2019-06-01',
      leaseTermMonths: 120,
      rentPsf: 92.5,
      dealStage: 'Renewal',
      relationship: 'occupier',
      salesforceId: '001XX000003DHPh',
      salesforceUrl: 'https://x.my.salesforce.com/001XX000003DHPh',
    });
  });

  it('defaults to the feed’s own meaning, not to the column', () => {
    // A report bound to the clients feed is a report of clients. The column is
    // only consulted when a team keeps one mixed report for everybody.
    const { rows } = toTenantRowsFromReport([row()], mapping, 'clients', 'https://x');
    expect(rows[0].relationship).toBe('client');
  });

  it('lets an explicit relationship column win', () => {
    const { rows } = toTenantRowsFromReport(
      [row({ Type: 'Prospect' })], mapping, 'clients', 'https://x');
    expect(rows[0].relationship).toBe('prospect');
  });

  it('treats a zero term as absent rather than drawing "0 months"', () => {
    const { rows } = toTenantRowsFromReport([row({ Term: '0' })], mapping, 'occupiers', 'https://x');
    expect(rows[0].leaseTermMonths).toBeNull();
  });

  it('skips a row with no company', () => {
    const { rows, skipped } = toTenantRowsFromReport(
      [row({ Company: '' })], mapping, 'occupiers', 'https://x');
    expect(rows).toHaveLength(0);
    expect(skipped[0].reason).toBe('no company name');
  });

  it('has no field that could carry an agent name', () => {
    expect(TENANT_FIELDS.some((f) => /agent/i.test(f.key))).toBe(false);
  });
});

describe('the row limit', () => {
  it('is the number Salesforce actually enforces', () => {
    expect(REPORT_ROW_LIMIT).toBe(2000);
  });
});

describe('lease standing', () => {
  it('counts whole months', () => {
    expect(monthsBetween('2026-08-11', '2027-08-11')).toBe(12);
    expect(monthsBetween('2026-08-11', '2026-08-31')).toBe(0);
    // Part-months only count once the day has passed, so a lease ending on the
    // 30th does not read a month short for most of the month.
    expect(monthsBetween('2026-08-20', '2027-08-11')).toBe(11);
  });

  it('labels the window a broker cares about', () => {
    expect(leaseStanding('2027-02-11', '2026-08-11')).toMatchObject({
      window: 'imminent', months: 6, label: 'in 6 months',
    });
    expect(leaseStanding('2028-02-11', '2026-08-11').window).toBe('active');
    expect(leaseStanding('2031-08-11', '2026-08-11').window).toBe('future');
  });

  it('says how long ago an expired lease rolled', () => {
    const past = leaseStanding('2026-05-11', '2026-08-11');
    expect(past.window).toBe('expired');
    expect(past.label).toBe('expired 3 months ago');
  });

  it('reads years past two, because "31 months" means nothing to anyone', () => {
    expect(leaseStanding('2029-02-11', '2026-08-11').label).toBe('in 2.5 years');
  });

  it('says nothing at all when there is no date', () => {
    expect(leaseStanding(null)).toEqual({ window: 'unknown', months: null, label: null });
    expect(leaseStanding('not a date')).toMatchObject({ window: 'unknown' });
  });
});
