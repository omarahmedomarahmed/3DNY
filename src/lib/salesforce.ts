import type { TenantRow } from '@/lib/tenant-csv';
import { parseRelationship } from '@/lib/tenant-csv';

/**
 * Pulls tenancies out of Salesforce.
 *
 * The shape of this is decided by one fact: **the CSV path is the product, and
 * this is the convenience.** A leasing team can always export from Salesforce
 * and drop the file in; that path is fully working and testable today. The API
 * saves them the export, and it can be down, unconfigured, or pointed at an org
 * whose fields are named something else entirely — so nothing here is allowed
 * to be the only way in, and every failure says plainly what to do instead.
 *
 * Configuration is entirely by environment variable, because a CRM credential
 * is not something to put in a database this app can render:
 *
 *   SALESFORCE_INSTANCE_URL   https://acme.my.salesforce.com
 *   SALESFORCE_CLIENT_ID      connected app's consumer key
 *   SALESFORCE_CLIENT_SECRET  connected app's consumer secret
 *   SALESFORCE_SOQL           optional — replaces the default query outright
 *   SALESFORCE_FIELD_MAP      optional — JSON, remaps our names to yours
 *
 * Authentication is the OAuth 2.0 client-credentials flow: no user, no refresh
 * token to store, no browser round trip. It needs a connected app with "Client
 * Credentials Flow" enabled and a run-as user — which is the right shape for a
 * server pulling a shared dataset on a schedule.
 *
 * **Field names are the part that will not match your org.** Every Salesforce
 * instance names its property fields differently, and there is no standard
 * object for "this company occupies these floors of this building". So the
 * query is overridable end to end, and the mapper works off aliases rather than
 * a fixed schema: whatever the SOQL aliases a column to, the mapper reads.
 */

export interface SalesforceConfig {
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
  soql: string;
  fieldMap: Record<string, string>;
}

/** Our names for the things a row has to supply. */
export const SALESFORCE_FIELDS = {
  id: 'Id',
  company: 'Company',
  address: 'Address',
  floors: 'Floors',
  suite: 'Suite',
  sf: 'SF',
  leaseStart: 'LeaseStart',
  leaseEnd: 'LeaseEnd',
  industry: 'Industry',
  relationship: 'Relationship',
  notes: 'Notes',
} as const;

/**
 * The default query, written against stock Account fields so it runs on a bare
 * org and returns something recognisable rather than an error about a field
 * that does not exist. Almost every real deployment will replace it.
 */
export const DEFAULT_SOQL = `
  SELECT Id, Name, BillingStreet, Industry, Type, Description
  FROM Account
  WHERE BillingCity = 'New York' AND BillingStreet != NULL
  LIMIT 2000
`.trim();

/** Reads config from the environment. Null when it is not set up. */
export function salesforceConfig(
  /** Loosely typed so a test can pass a bare object of the three it cares about. */
  env: Record<string, string | undefined> = process.env,
): SalesforceConfig | null {
  const instanceUrl = env.SALESFORCE_INSTANCE_URL?.trim();
  const clientId = env.SALESFORCE_CLIENT_ID?.trim();
  const clientSecret = env.SALESFORCE_CLIENT_SECRET?.trim();
  if (!instanceUrl || !clientId || !clientSecret) return null;

  let fieldMap: Record<string, string> = {};
  if (env.SALESFORCE_FIELD_MAP) {
    try {
      const parsed = JSON.parse(env.SALESFORCE_FIELD_MAP) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        fieldMap = parsed as Record<string, string>;
      }
    } catch {
      // A malformed map is ignored rather than fatal: the defaults below still
      // produce a usable sync, and failing the whole integration over a stray
      // comma in an env var would be a worse outcome than a partial mapping.
    }
  }

  return {
    instanceUrl: instanceUrl.replace(/\/+$/, ''),
    clientId,
    clientSecret,
    soql: env.SALESFORCE_SOQL?.trim() || DEFAULT_SOQL,
    fieldMap,
  };
}

export class SalesforceError extends Error {
  constructor(
    message: string,
    /** What the person reading this should do next. Always populated. */
    readonly remedy: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SalesforceError';
  }
}

const TOKEN_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 30_000;

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Client-credentials access token. Not cached: a sync is a rare operation. */
export async function getAccessToken(config: SalesforceConfig): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const res = await withTimeout(TOKEN_TIMEOUT_MS, (signal) =>
    fetch(`${config.instanceUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal,
    }),
  ).catch((err: Error) => {
    throw new SalesforceError(
      `Could not reach Salesforce (${err.message}).`,
      'Check SALESFORCE_INSTANCE_URL, and that this deployment can reach it. ' +
        'You can always export from Salesforce and use the CSV import instead.',
    );
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    throw new SalesforceError(
      json.error_description ?? json.error ?? `Salesforce refused the credentials (${res.status}).`,
      'Check the connected app has the Client Credentials Flow enabled and a run-as user, ' +
        'and that the key and secret are the current ones.',
      res.status,
    );
  }
  return json.access_token;
}

interface QueryResponse {
  records?: Record<string, unknown>[];
  done?: boolean;
  nextRecordsUrl?: string;
  totalSize?: number;
}

/**
 * Runs the SOQL and follows pagination.
 *
 * Salesforce returns 2000 records a page at most and hands back a cursor for
 * the rest. Following it matters: a firm with three thousand accounts that
 * silently imported the first two thousand would look like it worked.
 */
export async function runQuery(
  config: SalesforceConfig,
  token: string,
  soql = config.soql,
): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  let url = `${config.instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`;

  // Bounded, so a pathological cursor cannot spin forever.
  for (let page = 0; page < 50; page++) {
    const res = await withTimeout(QUERY_TIMEOUT_MS, (signal) =>
      fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal }),
    ).catch((err: Error) => {
      throw new SalesforceError(
        `Salesforce query failed (${err.message}).`,
        'Retry, or export the same report as CSV and use the tenant import.',
      );
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 400);
      throw new SalesforceError(
        `Salesforce rejected the query (${res.status}). ${detail}`,
        'The SOQL names a field this org does not have, or the run-as user cannot see it. ' +
          'Set SALESFORCE_SOQL to a query that works in your org.',
        res.status,
      );
    }

    const json = (await res.json()) as QueryResponse;
    records.push(...(json.records ?? []));
    if (json.done !== false || !json.nextRecordsUrl) break;
    url = `${config.instanceUrl}${json.nextRecordsUrl}`;
  }

  return records;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

/**
 * Finds a value under any of the names it might be filed under.
 *
 * Order: the explicit field map first, then our own alias, then the stock
 * Salesforce name. Nested lookups (`Account.Name`) are followed, because a
 * relationship query returns them nested rather than flattened.
 */
function pick(
  record: Record<string, unknown>,
  fieldMap: Record<string, string>,
  ours: string,
  fallbacks: string[],
): string {
  const names = [fieldMap[ours], ours, ...fallbacks].filter(Boolean) as string[];
  for (const name of names) {
    let value: unknown = record;
    for (const part of name.split('.')) {
      if (!value || typeof value !== 'object') {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[part];
    }
    if (value !== undefined && value !== null && str(value) !== '') return str(value);
  }
  return '';
}

/**
 * Salesforce records → the same rows the CSV importer produces.
 *
 * Deliberately converging on `TenantRow`: the CRM sync and the CSV import then
 * share one address matcher, one floor parser and one upsert, so a fix to any
 * of those reaches both and neither can drift into being the better-behaved
 * path.
 */
export function toTenantRows(
  records: Record<string, unknown>[],
  config: Pick<SalesforceConfig, 'instanceUrl' | 'fieldMap'>,
): { rows: TenantRow[]; skipped: { id: string; reason: string }[] } {
  const rows: TenantRow[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const { fieldMap, instanceUrl } = config;

  for (const record of records) {
    const id = pick(record, fieldMap, SALESFORCE_FIELDS.id, ['Id']);
    const company = pick(record, fieldMap, SALESFORCE_FIELDS.company, [
      'Name', 'Account.Name', 'AccountName',
    ]);
    const address = pick(record, fieldMap, SALESFORCE_FIELDS.address, [
      'BillingStreet', 'ShippingStreet', 'Account.BillingStreet', 'Street',
    ]);

    // No address means no building, and a tenancy without a building cannot be
    // drawn anywhere. Reported rather than dropped silently — an org where
    // most accounts have no billing street should find that out immediately.
    if (!company || !address) {
      skipped.push({
        id: id || '(no id)',
        reason: !company ? 'no company name' : `no address on ${company}`,
      });
      continue;
    }

    const sfRaw = pick(record, fieldMap, SALESFORCE_FIELDS.sf, ['RSF__c', 'SquareFeet__c']);
    const sf = Number.parseFloat(sfRaw.replace(/[^0-9.]/g, ''));

    rows.push({
      // Only the first line: Salesforce billing streets carry newlines, and the
      // address matcher wants the street line, not the whole block.
      address: address.split('\n')[0].trim(),
      companyName: company,
      floors: pick(record, fieldMap, SALESFORCE_FIELDS.floors, ['Floors__c', 'Floor__c']) || null,
      suite: pick(record, fieldMap, SALESFORCE_FIELDS.suite, ['Suite__c']) || null,
      sf: Number.isFinite(sf) && sf > 0 ? Math.round(sf) : null,
      leaseStart: isoDate(pick(record, fieldMap, SALESFORCE_FIELDS.leaseStart, [
        'Lease_Start__c', 'LeaseCommencement__c',
      ])),
      leaseExpiration: isoDate(pick(record, fieldMap, SALESFORCE_FIELDS.leaseEnd, [
        'Lease_Expiration__c', 'LeaseEnd__c',
      ])),
      industry: pick(record, fieldMap, SALESFORCE_FIELDS.industry, ['Industry']) || null,
      notes: pick(record, fieldMap, SALESFORCE_FIELDS.notes, ['Description']) || null,
      // An unrecognised Type falls back to 'occupier', never to 'client'. A
      // teal band says "this is our client" to a room, and being wrong in that
      // direction is the expensive mistake.
      relationship: parseRelationship(
        pick(record, fieldMap, SALESFORCE_FIELDS.relationship, ['Type', 'Status', 'StageName']),
        'occupier',
      ),
      salesforceId: id || null,
      salesforceUrl: id ? `${instanceUrl}/${id}` : null,
    });
  }

  return { rows, skipped };
}

/** Salesforce dates are already ISO; anything else is left for the CSV parser. */
function isoDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return m ? m[0] : null;
}
