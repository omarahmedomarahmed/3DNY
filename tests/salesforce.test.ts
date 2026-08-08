import { describe, expect, it } from 'vitest';
import { salesforceConfig, toTenantRows, DEFAULT_SOQL } from '../src/lib/salesforce';
import { parseRelationship } from '../src/lib/tenant-csv';

/**
 * I cannot test this against a real Salesforce org, so the tests cover the two
 * things that do not need one and would otherwise go wrong silently:
 *
 * - **the mapping**, which is where every org differs, and
 * - **the direction it fails in**. Guessing "client" from an unrecognised
 *   Type would put a teal band on a tower and tell a room that a company is
 *   ours when it is not. Every ambiguity resolves the other way.
 */

const ENV = {
  SALESFORCE_INSTANCE_URL: 'https://acme.my.salesforce.com/',
  SALESFORCE_CLIENT_ID: 'key',
  SALESFORCE_CLIENT_SECRET: 'secret',
};

describe('configuration', () => {
  it('is null until all three credentials are set', () => {
    expect(salesforceConfig({})).toBeNull();
    expect(
      salesforceConfig({ SALESFORCE_INSTANCE_URL: 'x', SALESFORCE_CLIENT_ID: 'y' }),
    ).toBeNull();
    expect(salesforceConfig(ENV)).not.toBeNull();
  });

  it('trims the trailing slash, so URLs do not double up', () => {
    expect(salesforceConfig(ENV)!.instanceUrl).toBe('https://acme.my.salesforce.com');
  });

  it('falls back to a query that runs on a stock org', () => {
    expect(salesforceConfig(ENV)!.soql).toBe(DEFAULT_SOQL);
  });

  it('survives a malformed field map rather than failing the integration', () => {
    // A stray comma in an env var should not take the whole sync down when the
    // defaults would still have produced a usable result.
    const config = salesforceConfig({ ...ENV, SALESFORCE_FIELD_MAP: '{oops' });
    expect(config).not.toBeNull();
    expect(config!.fieldMap).toEqual({});
  });
});

const CONFIG = { instanceUrl: 'https://acme.my.salesforce.com', fieldMap: {} };

describe('mapping records to tenancies', () => {
  it('reads the stock Account shape', () => {
    const { rows } = toTenantRows(
      [{ Id: '001x', Name: 'Example Co', BillingStreet: '100 Park Avenue', Industry: 'Legal', Type: 'Customer' }],
      CONFIG,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].companyName).toBe('Example Co');
    expect(rows[0].address).toBe('100 Park Avenue');
    expect(rows[0].salesforceId).toBe('001x');
    expect(rows[0].salesforceUrl).toBe('https://acme.my.salesforce.com/001x');
  });

  it('takes only the street line of a multi-line billing address', () => {
    // Salesforce billing streets carry newlines; the address matcher wants the
    // street, and handing it the whole block resolves nothing.
    const { rows } = toTenantRows(
      [{ Id: '1', Name: 'X', BillingStreet: '100 Park Avenue\nSuite 300\nNew York' }],
      CONFIG,
    );
    expect(rows[0].address).toBe('100 Park Avenue');
  });

  it('follows a nested relationship field', () => {
    const { rows } = toTenantRows(
      [{ Id: '1', Account: { Name: 'Nested Co', BillingStreet: '200 Park Avenue' } }],
      CONFIG,
    );
    expect(rows[0].companyName).toBe('Nested Co');
    expect(rows[0].address).toBe('200 Park Avenue');
  });

  it('lets an explicit field map win over every guess', () => {
    const { rows } = toTenantRows(
      [{ Id: '1', Name: 'Wrong', Tenant_Name__c: 'Right', Property__c: '9 E 40th Street' }],
      { ...CONFIG, fieldMap: { Company: 'Tenant_Name__c', Address: 'Property__c' } },
    );
    expect(rows[0].companyName).toBe('Right');
    expect(rows[0].address).toBe('9 E 40th Street');
  });

  it('reads square footage through the punctuation people type', () => {
    const { rows } = toTenantRows(
      [{ Id: '1', Name: 'X', BillingStreet: 'A', RSF__c: '24,394 SF' }],
      CONFIG,
    );
    expect(rows[0].sf).toBe(24394);
  });

  it('reports what it skipped instead of dropping it', () => {
    // An org where most accounts have no billing street should find that out
    // immediately, not by wondering where the bands went.
    const { rows, skipped } = toTenantRows(
      [
        { Id: '1', Name: 'No address here' },
        { Id: '2', BillingStreet: '100 Park Avenue' },
        { Id: '3', Name: 'Good', BillingStreet: '100 Park Avenue' },
      ],
      CONFIG,
    );
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(2);
    expect(skipped[0].reason).toContain('no address');
    expect(skipped[1].reason).toContain('no company');
  });
});

describe('never claims a company is our client on a guess', () => {
  it('maps the vocabularies that plainly mean client', () => {
    for (const type of ['Customer', 'Client', 'Closed Won', 'Active Client']) {
      expect(parseRelationship(type, 'occupier'), type).toBe('client');
    }
  });

  it('maps the vocabularies that plainly mean prospect', () => {
    for (const type of ['Prospect', 'Lead', 'Qualified', 'Opportunity']) {
      expect(parseRelationship(type, 'occupier'), type).toBe('prospect');
    }
  });

  it('falls back to occupier for anything it does not recognise', () => {
    // The expensive mistake is the teal band: it tells a room this company is
    // ours. Anything unrecognised has to land on the quiet side.
    for (const type of ['', 'Partner', 'Vendor', 'Reseller', 'Other', 'Franchise']) {
      expect(parseRelationship(type, 'occupier'), type).toBe('occupier');
    }
  });

  it('lets a client sheet default its own rows to client', () => {
    // The one place "client" may be assumed: a file explicitly uploaded as the
    // Cresa client roster.
    expect(parseRelationship('', 'client')).toBe('client');
    expect(parseRelationship('Prospect', 'client')).toBe('prospect');
  });

  it('maps an unrecognised Type on a Salesforce record to occupier too', () => {
    const { rows } = toTenantRows(
      [{ Id: '1', Name: 'X', BillingStreet: 'A', Type: 'Technology Partner' }],
      CONFIG,
    );
    expect(rows[0].relationship).toBe('occupier');
  });
});
