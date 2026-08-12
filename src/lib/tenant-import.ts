import { sql, normalizeAddress } from '@/lib/db';
import { geocodeAll } from '@/lib/address-matcher';
import { parseFloorList } from '@/lib/floor-list';
import { upsertBuilding } from '@/lib/queries';
import type { TenantRow } from '@/lib/tenant-csv';

/**
 * Puts a roster of tenancies onto buildings.
 *
 * The availability importer already does the hard half of this — turning free
 * text like "60 E 42nd Street - One Grand Central Place" into a BIN — and this
 * reuses it rather than growing a second address resolver that drifts.
 *
 * The important difference from the availability import is what happens to an
 * address the map has never seen. An availability sheet is our own inventory,
 * so an unmatched row is worth stopping for and reviewing. A tenant roster is
 * the whole market: it names buildings we hold nothing in and never will, and
 * refusing to import those would throw away most of the file. So a matched
 * address that is not yet a building **creates** one — with no spaces on it, so
 * it draws as part of the city until something is available there.
 *
 * A row whose address cannot be resolved at all is reported and skipped. It is
 * not guessed at: a tenancy on the wrong tower is worse than a tenancy missing.
 */

export interface TenantImportResult {
  importId: string;
  inserted: number;
  updated: number;
  skipped: number;
  buildingsCreated: number;
  /** Addresses that could not be resolved, with why. Shown, never swallowed. */
  unresolved: { address: string; company: string; reason: string }[];
}

export async function commitTenantImport(
  filename: string,
  rows: TenantRow[],
  opts: { source?: string; marketLabel?: string | null } = {},
): Promise<TenantImportResult> {
  const db = sql();
  const source = opts.source ?? 'csv';

  const importRows = (await db(
    `INSERT INTO imports (filename, market_label, row_count, matched_exact, matched_fuzzy, unmatched, status)
     VALUES ($1,$2,$3,0,0,0,'pending') RETURNING id`,
    [filename, opts.marketLabel ?? null, rows.length],
  )) as { id: string }[];
  const importId = importRows[0].id;

  // Resolve every distinct address once, in parallel, with the same worker
  // pool and circuit breaker the availability import uses.
  const geocoded = await geocodeAll(rows.map((r) => r.address));

  // Buildings we already have, by normalised address — a roster mostly names
  // buildings that are already on the map, and looking each one up separately
  // would be a request per row.
  const existing = new Map<string, string>();
  const knownIds = new Set<string>();
  for (const row of (await db(
    `SELECT id, address_normalized FROM buildings`,
  )) as { id: string; address_normalized: string }[]) {
    existing.set(row.address_normalized, row.id);
    knownIds.add(row.id);
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let buildingsCreated = 0;
  const unresolved: TenantImportResult['unresolved'] = [];

  for (const row of rows) {
    const match = geocoded.get(row.address);
    const normalized = normalizeAddress(match?.resolvedAddress ?? row.address);
    let buildingId = existing.get(normalized) ?? null;

    if (!buildingId) {
      if (!match || match.confidence === 'unmatched') {
        unresolved.push({
          address: row.address,
          company: row.companyName,
          reason: match?.explanation ?? 'Address could not be resolved.',
        });
        skipped++;
        continue;
      }
      buildingId = await upsertBuilding({
        addressDisplay: row.address,
        buildingName: null,
        bin: match.bin,
        bbl: match.bbl,
        lon: match.lon,
        lat: match.lat,
        class: null,
        submarket: null,
        submarketCluster: null,
        matchConfidence: match.confidence,
      });
      existing.set(normalized, buildingId);
      // Counted by id, not by whether the lookup above missed.
      //
      // `upsertBuilding` normalises the address its own way and finds rows this
      // map does not — the roster writes "100 Park Avenue" where the building
      // was created from the geocoder's own spelling. The lookup missing does
      // not mean a building was created, and reporting "6 buildings created"
      // for an import that created none is exactly the kind of number that
      // makes someone stop believing the rest of the report.
      if (!knownIds.has(buildingId)) {
        knownIds.add(buildingId);
        buildingsCreated++;
      }
    }

    const floorNumbers = parseFloorList(row.floors);

    // Two different keys, because a Salesforce row identifies itself and a
    // hand-kept row does not. Both end in an update rather than a duplicate:
    // re-importing last month's roster must not double every tenancy.
    const result = row.salesforceId
      ? ((await db(
          `INSERT INTO tenants (
             building_id, company_name, floors, floor_numbers, suite, sf,
             lease_start, lease_expiration, industry, notes, relationship,
             source, salesforce_id, salesforce_url, source_import_id,
             lease_term_months, rent_psf, deal_stage, last_synced_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now())
           ON CONFLICT (salesforce_id) WHERE salesforce_id IS NOT NULL
           DO UPDATE SET
             building_id      = EXCLUDED.building_id,
             company_name     = EXCLUDED.company_name,
             floors           = EXCLUDED.floors,
             floor_numbers    = EXCLUDED.floor_numbers,
             suite            = EXCLUDED.suite,
             sf               = EXCLUDED.sf,
             lease_start      = EXCLUDED.lease_start,
             lease_expiration = EXCLUDED.lease_expiration,
             industry         = EXCLUDED.industry,
             notes            = EXCLUDED.notes,
             relationship     = EXCLUDED.relationship,
             source           = EXCLUDED.source,
             salesforce_url   = EXCLUDED.salesforce_url,
             source_import_id = EXCLUDED.source_import_id,
             lease_term_months = EXCLUDED.lease_term_months,
             rent_psf         = EXCLUDED.rent_psf,
             deal_stage       = EXCLUDED.deal_stage,
             last_synced_at   = now(),
             -- The CRM has just overwritten these, so any note that one was
             -- corrected by hand now describes a value that is gone.
             field_sources    = '{}'::jsonb
           RETURNING (xmax = 0) AS was_inserted`,
          [
            buildingId, row.companyName, row.floors, floorNumbers, row.suite, row.sf,
            row.leaseStart, row.leaseExpiration, row.industry, row.notes,
            row.relationship, source, row.salesforceId, row.salesforceUrl, importId,
            row.leaseTermMonths ?? null, row.rentPsf ?? null, row.dealStage ?? null,
          ],
        )) as { was_inserted: boolean }[])
      : ((await db(
          `INSERT INTO tenants (
             building_id, company_name, floors, floor_numbers, suite, sf,
             lease_start, lease_expiration, industry, notes, relationship,
             source, source_import_id, lease_term_months, rent_psf, deal_stage
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (building_id, lower(company_name), COALESCE(floors, ''))
             WHERE salesforce_id IS NULL
           DO UPDATE SET
             floor_numbers    = EXCLUDED.floor_numbers,
             suite            = EXCLUDED.suite,
             sf               = EXCLUDED.sf,
             lease_start      = EXCLUDED.lease_start,
             lease_expiration = EXCLUDED.lease_expiration,
             industry         = EXCLUDED.industry,
             notes            = EXCLUDED.notes,
             relationship     = EXCLUDED.relationship,
             source           = EXCLUDED.source,
             source_import_id = EXCLUDED.source_import_id,
             lease_term_months = EXCLUDED.lease_term_months,
             rent_psf         = EXCLUDED.rent_psf,
             deal_stage       = EXCLUDED.deal_stage,
             field_sources    = '{}'::jsonb
           RETURNING (xmax = 0) AS was_inserted`,
          [
            buildingId, row.companyName, row.floors, floorNumbers, row.suite, row.sf,
            row.leaseStart, row.leaseExpiration, row.industry, row.notes,
            row.relationship, source, importId,
            row.leaseTermMonths ?? null, row.rentPsf ?? null, row.dealStage ?? null,
          ],
        )) as { was_inserted: boolean }[]);

    if (result[0]?.was_inserted) inserted++;
    else updated++;
  }

  await db(
    `UPDATE imports SET status = 'committed', matched_exact = $2, unmatched = $3 WHERE id = $1`,
    [importId, inserted + updated, skipped],
  );

  return { importId, inserted, updated, skipped, buildingsCreated, unresolved };
}
