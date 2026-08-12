/**
 * A stand-in Salesforce org, for proving the integration without one.
 *
 * The Salesforce path cannot be tested against a real org here — there isn't
 * one, and there would not be one in CI either. But "we could not test it" is
 * how an integration ships broken, so this serves the four endpoints the app
 * actually calls, shaped exactly as Salesforce shapes them: the client
 * credentials token exchange, userinfo, a SOQL query for the Report list, and
 * the Analytics report run with its `factMap` of `dataCells`.
 *
 * The report it serves is deliberately awkward in the ways real ones are:
 *
 *   - both a "Building" and a "Building Address" column, which is the pair a
 *     naive mapper gets backwards
 *   - "Upon Request" in the rent column
 *   - a row with no floor, which must be skipped rather than placed at ground
 *   - Salesforce's "-" for an empty cell
 *
 *   node scripts/fake-salesforce.mjs [port]
 */

import { createServer } from 'node:http';

const PORT = Number(process.argv[2] ?? 4599);

const REPORTS = [
  { Id: '00O000000000001', Name: 'Available Spaces – NYC', DeveloperName: 'Available_Spaces_NYC',
    FolderName: 'Leasing', Format: 'TABULAR', LastRunDate: '2026-08-10T12:00:00.000+0000' },
  { Id: '00O000000000002', Name: 'Active Occupiers', DeveloperName: 'Active_Occupiers',
    FolderName: 'Leasing', Format: 'TABULAR', LastRunDate: '2026-08-09T12:00:00.000+0000' },
  { Id: '00O000000000003', Name: 'Cresa Client Roster', DeveloperName: 'Client_Roster',
    FolderName: 'Client Services', Format: 'SUMMARY', LastRunDate: null },
  { Id: '00O000000000004', Name: 'Pipeline by Owner', DeveloperName: 'Pipeline',
    FolderName: 'Sales', Format: 'MATRIX', LastRunDate: null },
];

const SPACES_COLUMNS = {
  'AscendixRE__Property__r.Name': { label: 'Building', dataType: 'string' },
  'AscendixRE__Property__r.Address__c': { label: 'Building Address', dataType: 'string' },
  'AscendixRE__Floor__c': { label: 'Floor', dataType: 'string' },
  'AscendixRE__Available_SF__c': { label: 'Available SF', dataType: 'double' },
  'AscendixRE__Asking_Rent__c': { label: 'Asking Rent', dataType: 'currency' },
  'AscendixRE__Date_Available__c': { label: 'Date Available', dataType: 'date' },
  'AscendixRE__Lease_Type__c': { label: 'Lease Type', dataType: 'picklist' },
  'AscendixRE__Leasing_Company__c': { label: 'Leasing Company', dataType: 'string' },
};

const SPACE_ROWS = [
  ['One Grand Central Place', '60 E 42nd Street', '14', '12,500', '$88.00', '6/1/2026', 'Direct', 'Example Leasing'],
  ['One Grand Central Place', '60 E 42nd Street', '22', '9,100', 'Upon Request', '9/1/2026', 'Direct', 'Example Leasing'],
  ['The Emporis Building', '100 Park Avenue', '31', '24,000', '$104.00', '-', 'Sublease', 'Example Leasing'],
  ['Empire State Building', '350 Fifth Avenue', '63', '18,750', '$97.50', '1/1/2027', 'Direct', 'Example Leasing'],
  // No floor: must be reported as skipped, never placed on the ground floor.
  ['111 West 33rd Street', '111 West 33rd Street', '', '5,000', '$70.00', '-', 'Direct', 'Example Leasing'],
];

const OCCUPIER_COLUMNS = {
  'Account.Name': { label: 'Account Name', dataType: 'string' },
  'Account.BillingStreet': { label: 'Billing Street Address', dataType: 'string' },
  'Floors__c': { label: 'Floors', dataType: 'string' },
  'Leased_SF__c': { label: 'Leased SF', dataType: 'double' },
  'Lease_Expiration__c': { label: 'Lease Expiration', dataType: 'date' },
  'Lease_Term__c': { label: 'Lease Term (Months)', dataType: 'double' },
  'Base_Rent__c': { label: 'Base Rent', dataType: 'currency' },
  'StageName': { label: 'Stage Name', dataType: 'picklist' },
  'Account.Id': { label: 'Account ID', dataType: 'id' },
};

const OCCUPIER_ROWS = [
  ['Northwind Capital', '60 E 42nd Street', '30-32', '48,000', '5/31/2027', '120', '$85.00', 'Renewal', '001XX000003DHP1'],
  ['Harbour Analytics', '100 Park Avenue', '18', '15,200', '12/31/2029', '84', '$92.00', 'Signed', '001XX000003DHP2'],
];

function factMap(rows) {
  return {
    'T!T': {
      rows: rows.map((cells) => ({
        dataCells: cells.map((label) => ({ label, value: label })),
      })),
    },
  };
}

/**
 * What the stub is pretending happened in Salesforce since the last sync.
 * Driven by `/__control` so a harness can test the behaviour that matters
 * most: a floor leaving the report, and a truncated read.
 */
const state = { dropFloors: [], truncate: false };

function reportBody(id) {
  const spaces = id === '00O000000000001';
  const columns = spaces ? SPACES_COLUMNS : OCCUPIER_COLUMNS;
  let rows = spaces ? SPACE_ROWS : OCCUPIER_ROWS;
  if (spaces && state.dropFloors.length > 0) {
    rows = rows.filter((r) => !state.dropFloors.includes(r[2]));
  }
  return {
    reportMetadata: {
      name: REPORTS.find((r) => r.Id === id)?.Name ?? 'Report',
      reportFormat: 'TABULAR',
      detailColumns: Object.keys(columns),
    },
    reportExtendedMetadata: { detailColumnInfo: columns },
    factMap: factMap(rows),
    allData: !state.truncate,
  };
}

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  // Not a Salesforce endpoint — the harness's way of saying "somebody edited
  // the report". `?drop=14,22` takes those floors out; `?truncate=1` makes the
  // response claim it was cut off at the row limit.
  if (path === '/__control') {
    const drop = url.searchParams.get('drop');
    state.dropFloors = drop ? drop.split(',').map((s) => s.trim()).filter(Boolean) : [];
    state.truncate = url.searchParams.get('truncate') === '1';
    return json(res, 200, state);
  }

  if (path === '/services/oauth2/token') {
    return json(res, 200, {
      access_token: 'FAKE_TOKEN',
      instance_url: `http://localhost:${PORT}`,
      token_type: 'Bearer',
    });
  }

  if (path === '/services/oauth2/userinfo') {
    return json(res, 200, {
      organization_id: '00D000000000001EAA',
      username: 'integration@cresa.example',
      display_name: 'Cresa Integration User',
    });
  }

  // The report list arrives as SOQL against the Report object.
  if (path.endsWith('/query')) {
    return json(res, 200, { totalSize: REPORTS.length, done: true, records: REPORTS });
  }

  const run = path.match(/\/analytics\/reports\/([^/]+)$/);
  if (run) {
    if (!REPORTS.some((r) => r.Id === run[1])) {
      return json(res, 404, [{ errorCode: 'NOT_FOUND', message: 'Report not found' }]);
    }
    return json(res, 200, reportBody(run[1]));
  }

  const describe = path.match(/\/analytics\/reports\/([^/]+)\/describe$/);
  if (describe) {
    const body = reportBody(describe[1]);
    return json(res, 200, {
      reportMetadata: body.reportMetadata,
      reportExtendedMetadata: body.reportExtendedMetadata,
    });
  }

  json(res, 404, [{ errorCode: 'NOT_FOUND', message: `No stub for ${path}` }]);
});

server.listen(PORT, () => {
  console.log(`Stand-in Salesforce on http://localhost:${PORT}`);
});
