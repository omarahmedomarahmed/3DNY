import { sql, normalizeAddress } from '@/lib/db';
import { fieldSourceAssignment } from '@/lib/field-stamp';
import type {
  Building,
  BuildingWithSpaces,
  FieldSources,
  Landlord,
  MatchedRow,
  Space,
  Tenant,
} from '@/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

function toBuilding(r: any): Building {
  return {
    id: r.id,
    bin: r.bin,
    bbl: r.bbl,
    address_normalized: r.address_normalized,
    address_display: r.address_display,
    building_name: r.building_name,
    landlord_id: r.landlord_id,
    landlord_name: r.landlord_name ?? null,
    class: r.class ?? null,
    submarket: r.submarket,
    submarket_cluster: r.submarket_cluster,
    num_floors: r.num_floors,
    height_roof_ft: r.height_roof_ft === null ? null : Number(r.height_roof_ft),
    year_built: r.year_built,
    bldg_area_sf: r.bldg_area_sf === null ? null : Number(r.bldg_area_sf),
    lon: r.lon === null || r.lon === undefined ? null : Number(r.lon),
    lat: r.lat === null || r.lat === undefined ? null : Number(r.lat),
    footprint: r.footprint ?? null,
    match_confidence: r.match_confidence,
    floor_height_override:
      r.floor_height_override === null ? null : Number(r.floor_height_override),
    notes: r.notes,
    field_sources: toFieldSources(r.field_sources),
    updated_at: r.updated_at,
  };
}

/**
 * jsonb comes back as an object from the driver but as a string from some
 * pooled paths, and a row read before the column existed has neither. All
 * three have to end up as a plain object, because the caller of this is a
 * tooltip and a tooltip must not be able to throw.
 */
function toFieldSources(value: unknown): FieldSources {
  if (!value) return {};
  const raw =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: FieldSources = {};
  for (const [field, stamp] of Object.entries(raw as Record<string, unknown>)) {
    if (!stamp || typeof stamp !== 'object') continue;
    const { kind, at, ref } = stamp as Record<string, unknown>;
    if (typeof kind !== 'string' || !kind) continue;
    out[field] = {
      kind,
      at: typeof at === 'string' ? at : undefined,
      ref: typeof ref === 'string' ? ref : undefined,
    };
  }
  return out;
}

function toSpace(r: any): Space {
  return {
    id: r.id,
    building_id: r.building_id,
    floor_number: r.floor_number,
    floor_label: r.floor_label,
    floor_portion: r.floor_portion,
    sf: r.sf,
    asking_rent_psf: r.asking_rent_psf === null ? null : Number(r.asking_rent_psf),
    asking_rent_withheld: r.asking_rent_withheld,
    space_use: r.space_use,
    lease_type: r.lease_type,
    sub_landlord: r.sub_landlord,
    occupancy_raw: r.occupancy_raw,
    available_from: r.available_from,
    term_raw: r.term_raw,
    term_expires: r.term_expires,
    leasing_company: r.leasing_company,
    agent_name: r.agent_name,
    agent_email: r.agent_email,
    agent_email_suspect: r.agent_email_suspect,
    date_added: r.date_added,
    source_import_id: r.source_import_id,
    import_filename: r.import_filename ?? null,
    import_uploaded_at: r.import_uploaded_at ?? null,
    field_sources: toFieldSources(r.field_sources),
    notes: r.notes,
    is_active: r.is_active,
    updated_at: r.updated_at,
  };
}

const BUILDING_COLUMNS = `
  b.id, b.bin, b.bbl, b.address_normalized, b.address_display, b.building_name,
  b.landlord_id, l.name AS landlord_name, b.class, b.submarket, b.submarket_cluster,
  b.num_floors, b.height_roof_ft, b.year_built, b.bldg_area_sf,
  ST_X(b.centroid::geometry) AS lon,
  ST_Y(b.centroid::geometry) AS lat,
  CASE WHEN b.footprint IS NULL THEN NULL
       ELSE (ST_AsGeoJSON(b.footprint::geometry)::json -> 'coordinates' -> 0)
  END AS footprint,
  b.match_confidence, b.floor_height_override, b.notes, b.field_sources, b.updated_at
`;

/** Every building with at least one space, joined with its spaces. */
export async function getBuildingsWithSpaces(): Promise<BuildingWithSpaces[]> {
  const db = sql();

  const [buildingRows, spaceRows, tenantRows] = await Promise.all([
    db(`SELECT ${BUILDING_COLUMNS}
        FROM buildings b LEFT JOIN landlords l ON l.id = b.landlord_id
        ORDER BY b.address_display`),
    // The import is joined in rather than fetched separately, so every place
    // that renders a space can also say which sheet it came from and when.
    // Provenance that needs a second request is provenance that will be
    // missing wherever someone forgot to make it.
    db(`SELECT s.*, i.filename AS import_filename, i.uploaded_at AS import_uploaded_at
        FROM spaces s LEFT JOIN imports i ON i.id = s.source_import_id
        WHERE s.is_active ORDER BY s.floor_number NULLS LAST`),
    db(`SELECT * FROM tenants ORDER BY company_name`),
  ]);

  const spacesByBuilding = new Map<string, Space[]>();
  for (const row of spaceRows as any[]) {
    const s = toSpace(row);
    const list = spacesByBuilding.get(s.building_id) ?? [];
    list.push(s);
    spacesByBuilding.set(s.building_id, list);
  }

  const tenantsByBuilding = new Map<string, Tenant[]>();
  for (const row of tenantRows as any[]) {
    const list = tenantsByBuilding.get(row.building_id) ?? [];
    list.push(row as Tenant);
    tenantsByBuilding.set(row.building_id, list);
  }

  return (buildingRows as any[]).map((row) => {
    const building = toBuilding(row);
    const spaces = spacesByBuilding.get(building.id) ?? [];
    const tenants = tenantsByBuilding.get(building.id) ?? [];
    const rents = spaces
      .map((s) => s.asking_rent_psf)
      .filter((r): r is number => r !== null);
    return {
      ...building,
      spaces,
      tenants,
      minRent: rents.length ? Math.min(...rents) : null,
      maxRent: rents.length ? Math.max(...rents) : null,
      totalAvailableSf: spaces.reduce((sum, s) => sum + (s.sf ?? 0), 0),
      spaceCount: spaces.length,
    };
  });
}

export async function getBuilding(id: string): Promise<BuildingWithSpaces | null> {
  const all = await getBuildingsWithSpaces();
  return all.find((b) => b.id === id) ?? null;
}

/** Look up a permanent manual match recorded by a user. */
export async function findAlias(rawAddress: string): Promise<string | null> {
  const db = sql();
  const rows = (await db(
    `SELECT building_id FROM address_aliases WHERE raw_address = $1`,
    [rawAddress.trim().toLowerCase()],
  )) as any[];
  return rows[0]?.building_id ?? null;
}

export async function saveAlias(rawAddress: string, buildingId: string) {
  const db = sql();
  await db(
    `INSERT INTO address_aliases (raw_address, building_id) VALUES ($1, $2)
     ON CONFLICT (raw_address) DO UPDATE SET building_id = EXCLUDED.building_id`,
    [rawAddress.trim().toLowerCase(), buildingId],
  );
}

/** Insert or update a building keyed on its normalised address. */
export async function upsertBuilding(input: {
  addressDisplay: string;
  buildingName: string | null;
  bin: string | null;
  bbl: string | null;
  lon: number | null;
  lat: number | null;
  class: string | null;
  submarket: string | null;
  submarketCluster: string | null;
  matchConfidence: string;
}): Promise<string> {
  const db = sql();
  const normalized = normalizeAddress(input.addressDisplay);
  const point =
    input.lon !== null && input.lat !== null
      ? `SRID=4326;POINT(${input.lon} ${input.lat})`
      : null;

  const rows = (await db(
    `INSERT INTO buildings (
       address_normalized, address_display, building_name, bin, bbl,
       centroid, class, submarket, submarket_cluster, match_confidence
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (address_normalized) DO UPDATE SET
       building_name     = COALESCE(EXCLUDED.building_name, buildings.building_name),
       bin               = COALESCE(EXCLUDED.bin, buildings.bin),
       bbl               = COALESCE(EXCLUDED.bbl, buildings.bbl),
       centroid          = COALESCE(EXCLUDED.centroid, buildings.centroid),
       class             = COALESCE(EXCLUDED.class, buildings.class),
       submarket         = COALESCE(EXCLUDED.submarket, buildings.submarket),
       submarket_cluster = COALESCE(EXCLUDED.submarket_cluster, buildings.submarket_cluster),
       -- never downgrade a confidence a human already confirmed
       match_confidence  = CASE WHEN buildings.match_confidence = 'manual'
                                THEN 'manual' ELSE EXCLUDED.match_confidence END
     RETURNING id`,
    [
      normalized,
      input.addressDisplay,
      input.buildingName,
      input.bin,
      input.bbl,
      point,
      input.class,
      input.submarket,
      input.submarketCluster,
      input.matchConfidence,
    ],
  )) as any[];

  return rows[0].id as string;
}

/**
 * Attaches the real NYC footprint polygon and dimensions to a building.
 * Without this a building extrudes as a generic box at a guessed height, and
 * floor bands have nothing defensible to sit on.
 */
export async function enrichBuildingGeometry(
  buildingId: string,
  bin: string | null,
  bbl: string | null,
): Promise<string> {
  if (!bin && !bbl) return 'No BIN or BBL to look up.';

  const { fetchFootprint } = await import('@/lib/footprints');
  const data = await fetchFootprint(bin, bbl);
  const db = sql();

  // PostGIS wants a closed ring; NYC data sometimes omits the repeat point.
  let polygon: string | null = null;
  if (data.ring && data.ring.length >= 4) {
    const ring = [...data.ring];
    const [fx, fy] = ring[0];
    const [lx, ly] = ring[ring.length - 1];
    if (fx !== lx || fy !== ly) ring.push([fx, fy]);
    polygon = `SRID=4326;POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(',')}))`;
  }

  await db(
    `UPDATE buildings SET
       footprint      = COALESCE($2::geography, footprint),
       height_roof_ft = COALESCE($3, height_roof_ft),
       num_floors     = COALESCE($4, num_floors),
       year_built     = COALESCE($5, year_built),
       bldg_area_sf   = COALESCE($6, bldg_area_sf),
       centroid       = COALESCE(centroid,
                          CASE WHEN $2 IS NULL THEN NULL
                               ELSE ST_Centroid($2::geometry)::geography END)
     WHERE id = $1`,
    [
      buildingId,
      polygon,
      data.heightRoofFt,
      data.numFloors,
      data.yearBuilt ?? data.constructionYear,
      data.bldgAreaSf,
    ],
  );

  // The city's ownership record is a far better landlord signal than the
  // leasing company on the sheet — Cushman & Wakefield markets 540 Madison,
  // it does not own it.
  if (data.ownerName) {
    await ensureLandlordForBuilding(buildingId, data.ownerName);
  }

  return data.note;
}

/**
 * Gives every building a landlord record to edit rather than making the team
 * create them from scratch. Seeded from the city's owner of record, flagged
 * for review because an LLC on a deed is rarely the name a broker would use.
 */
export async function ensureLandlordForBuilding(
  buildingId: string,
  ownerName: string,
  addressDisplay?: string,
): Promise<string | null> {
  const db = sql();
  let name = ownerName.trim();

  // PLUTO writes literal placeholders where ownership is not published. Left
  // as-is they collapse several unrelated buildings onto one landlord record,
  // so edits to one would silently change the others.
  const PLACEHOLDERS = ['unavailable owner', 'unavailable', 'n/a', 'unknown', 'none'];
  if (!name || PLACEHOLDERS.includes(name.toLowerCase())) {
    const address =
      addressDisplay ??
      ((await db(`SELECT address_display FROM buildings WHERE id = $1`, [buildingId])) as any[])[0]
        ?.address_display;
    if (!address) return null;
    name = `Owner of ${address}`;
  }

  // Never overwrite a landlord a human has already curated.
  const existing = (await db(
    `SELECT landlord_id FROM buildings WHERE id = $1`,
    [buildingId],
  )) as any[];
  if (existing[0]?.landlord_id) return existing[0].landlord_id as string;

  const ownerOfRecord = name === ownerName.trim() ? name : null;
  const rows = (await db(
    `INSERT INTO landlords (name, owner_of_record, source, needs_review)
     VALUES ($1, $2, 'city_record', true)
     ON CONFLICT (name) DO UPDATE SET owner_of_record = COALESCE(landlords.owner_of_record, EXCLUDED.owner_of_record)
     RETURNING id`,
    [name, ownerOfRecord],
  )) as any[];

  const landlordId = rows[0]?.id as string | undefined;
  if (!landlordId) return null;

  await db(`UPDATE buildings SET landlord_id = $2 WHERE id = $1 AND landlord_id IS NULL`, [
    buildingId,
    landlordId,
  ]);

  // Keep the portfolio count honest as buildings accumulate.
  await db(
    `UPDATE landlords l SET buildings_owned = (
       SELECT count(*) FROM buildings b WHERE b.landlord_id = l.id
     ) WHERE l.id = $1`,
    [landlordId],
  );

  return landlordId;
}

/** Backfills landlords for buildings that already have an owner on file. */
export async function ensureLandlordsForAllBuildings(): Promise<{
  linked: number;
  created: number;
}> {
  const db = sql();
  const rows = (await db(
    `SELECT id, bin, bbl, address_display FROM buildings WHERE landlord_id IS NULL AND bbl IS NOT NULL`,
  )) as any[];

  const before = (await db(`SELECT count(*)::int AS n FROM landlords`)) as any[];
  let linked = 0;

  const { fetchFootprint } = await import('@/lib/footprints');
  for (const row of rows) {
    try {
      const data = await fetchFootprint(null, row.bbl);
      if (await ensureLandlordForBuilding(row.id, data.ownerName ?? '', row.address_display)) {
        linked++;
      }
    } catch {
      // A single failed lookup must not abort the backfill.
    }
  }

  const after = (await db(`SELECT count(*)::int AS n FROM landlords`)) as any[];
  return { linked, created: (after[0]?.n ?? 0) - (before[0]?.n ?? 0) };
}

/** Enriches every building that still has no footprint. Safe to re-run. */
export async function enrichMissingGeometry(limit = 200): Promise<{
  attempted: number;
  succeeded: number;
  notes: string[];
}> {
  const db = sql();
  const rows = (await db(
    `SELECT id, bin, bbl FROM buildings
     WHERE footprint IS NULL AND (bin IS NOT NULL OR bbl IS NOT NULL)
     LIMIT $1`,
    [limit],
  )) as any[];

  const notes: string[] = [];
  let succeeded = 0;

  for (const row of rows) {
    try {
      const note = await enrichBuildingGeometry(row.id, row.bin, row.bbl);
      if (note) notes.push(note);
      succeeded++;
    } catch (err) {
      notes.push(`Building ${row.id}: ${(err as Error).message}`);
    }
  }

  return { attempted: rows.length, succeeded, notes };
}

/** Commits a fully matched import. Returns per-row outcomes. */
export async function commitImport(
  filename: string,
  marketLabel: string | null,
  rows: MatchedRow[],
): Promise<{ importId: string; inserted: number; updated: number; skipped: number }> {
  const db = sql();

  const importRows = (await db(
    `INSERT INTO imports (filename, market_label, row_count, matched_exact, matched_fuzzy, unmatched, status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING id`,
    [
      filename,
      marketLabel,
      rows.length,
      rows.filter((r) => r.match.confidence === 'exact').length,
      rows.filter((r) => r.match.confidence === 'fuzzy').length,
      rows.filter((r) => r.match.confidence === 'unmatched').length,
    ],
  )) as any[];
  const importId = importRows[0].id as string;

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (row.match.confidence === 'unmatched' && !row.match.buildingId) {
      skipped++;
      continue;
    }

    const buildingId =
      row.match.buildingId ??
      (await upsertBuilding({
        addressDisplay: row.addressDisplay,
        buildingName: row.buildingName,
        bin: row.match.bin,
        bbl: row.match.bbl,
        lon: row.match.lon,
        lat: row.match.lat,
        class: row.buildingClass,
        submarket: row.submarket,
        submarketCluster: row.submarketCluster,
        matchConfidence: row.match.confidence,
      }));

    const result = (await db(
      `INSERT INTO spaces (
         building_id, floor_number, floor_label, floor_portion, sf,
         asking_rent_psf, asking_rent_withheld, space_use, lease_type, sub_landlord,
         occupancy_raw, available_from, term_raw, term_expires,
         leasing_company, agent_name, agent_email, agent_email_suspect,
         date_added, source_import_id, notes, is_active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,true)
       ON CONFLICT (building_id, floor_label, COALESCE(sf, -1), COALESCE(date_added, '1900-01-01'))
       DO UPDATE SET
         asking_rent_psf      = EXCLUDED.asking_rent_psf,
         asking_rent_withheld = EXCLUDED.asking_rent_withheld,
         space_use            = EXCLUDED.space_use,
         lease_type           = EXCLUDED.lease_type,
         occupancy_raw        = EXCLUDED.occupancy_raw,
         available_from       = EXCLUDED.available_from,
         term_raw             = EXCLUDED.term_raw,
         term_expires         = EXCLUDED.term_expires,
         leasing_company      = EXCLUDED.leasing_company,
         agent_name           = EXCLUDED.agent_name,
         agent_email          = EXCLUDED.agent_email,
         agent_email_suspect  = EXCLUDED.agent_email_suspect,
         source_import_id     = EXCLUDED.source_import_id,
         is_active            = true,
         -- A newer sheet has just overwritten these columns, so any note that
         -- one of them was corrected by hand is now describing a value that no
         -- longer exists. Only the keys this statement actually writes are
         -- dropped: a hand-typed SF or note the import leaves alone keeps its
         -- stamp.
         field_sources        = spaces.field_sources - ARRAY[
           'asking_rent_psf','asking_rent_withheld','space_use','lease_type',
           'occupancy_raw','available_from','term_raw','term_expires',
           'leasing_company'
         ]
       RETURNING (xmax = 0) AS was_inserted`,
      [
        buildingId,
        row.floorNumber,
        row.floorLabel,
        row.floorPortion,
        row.sf,
        row.askingRentPsf,
        row.askingRentWithheld,
        row.spaceUse,
        row.leaseType,
        row.subLandlord,
        row.occupancyRaw,
        row.availableFrom,
        row.termRaw,
        row.termExpires,
        row.leasingCompany,
        row.agentName,
        row.agentEmail,
        row.agentEmailSuspect,
        row.dateAdded,
        importId,
        row.notes,
      ],
    )) as any[];

    if (result[0]?.was_inserted) inserted++;
    else updated++;
  }

  await db(`UPDATE imports SET status = 'committed' WHERE id = $1`, [importId]);

  // Pull real footprints for anything newly created. Best-effort: a failed
  // lookup must never lose an import the user already reviewed.
  try {
    await enrichMissingGeometry();
  } catch {
    // Geometry can be backfilled later from Setup.
  }

  return { importId, inserted, updated, skipped };
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

const SPACE_EDITABLE = new Set([
  'floor_number', 'floor_label', 'floor_portion', 'sf', 'asking_rent_psf',
  'asking_rent_withheld', 'space_use', 'lease_type', 'sub_landlord',
  'occupancy_raw', 'available_from', 'term_raw', 'term_expires',
  'leasing_company', 'agent_name', 'agent_email', 'agent_email_suspect',
  'date_added', 'notes', 'is_active',
]);

const BUILDING_EDITABLE = new Set([
  'address_display', 'building_name', 'landlord_id', 'class', 'submarket',
  'submarket_cluster', 'num_floors', 'height_roof_ft', 'year_built',
  'bldg_area_sf', 'floor_height_override', 'notes', 'bin', 'bbl',
  'match_confidence',
]);

const TENANT_EDITABLE = new Set([
  'company_name', 'floors', 'sf', 'lease_expiration', 'industry', 'notes', 'source',
]);

const LANDLORD_EDITABLE = new Set([
  'name', 'aliases', 'insights_md', 'amenities', 'portfolio_sf',
  'buildings_owned', 'avg_asking_rent', 'notable_tenants',
  'contact_name', 'contact_email', 'contact_phone',
  'owner_of_record', 'needs_review',
]);

async function patchRow(
  table: string,
  allowed: Set<string>,
  id: string,
  patch: Record<string, unknown>,
  /** What is doing the writing. A CRM sync would pass its own kind. */
  kind = 'manual',
) {
  const entries = Object.entries(patch).filter(([k]) => allowed.has(k));
  if (entries.length === 0) return null;

  const assignments = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const values: unknown[] = [id, ...entries.map(([, v]) => v)];
  const stamp = fieldSourceAssignment(table, Object.fromEntries(entries), values, kind);

  const db = sql();
  const rows = (await db(
    `UPDATE ${table} AS t SET ${assignments}${stamp} WHERE t.id = $1 RETURNING *`,
    values,
  )) as any[];
  return rows[0] ?? null;
}

export const updateSpace = (id: string, patch: Record<string, unknown>, kind?: string) =>
  patchRow('spaces', SPACE_EDITABLE, id, patch, kind);

export const updateBuilding = (id: string, patch: Record<string, unknown>, kind?: string) =>
  patchRow('buildings', BUILDING_EDITABLE, id, patch, kind);

export const updateTenant = (id: string, patch: Record<string, unknown>) =>
  patchRow('tenants', TENANT_EDITABLE, id, patch);

export const updateLandlord = (id: string, patch: Record<string, unknown>) =>
  patchRow('landlords', LANDLORD_EDITABLE, id, patch);

export async function createTenant(input: {
  building_id: string;
  company_name: string;
  floors?: string | null;
  sf?: number | null;
  lease_expiration?: string | null;
  industry?: string | null;
  notes?: string | null;
  source?: string;
}): Promise<Tenant> {
  const db = sql();
  const rows = (await db(
    `INSERT INTO tenants (building_id, company_name, floors, sf, lease_expiration, industry, notes, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      input.building_id,
      input.company_name,
      input.floors ?? null,
      input.sf ?? null,
      input.lease_expiration ?? null,
      input.industry ?? null,
      input.notes ?? null,
      input.source ?? 'manual',
    ],
  )) as any[];
  return rows[0] as Tenant;
}

export async function deleteRow(table: 'spaces' | 'tenants' | 'space_images', id: string) {
  const db = sql();
  await db(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

export async function getLandlords(): Promise<Landlord[]> {
  const db = sql();
  return (await db(`SELECT * FROM landlords ORDER BY name`)) as unknown as Landlord[];
}

export async function upsertLandlord(input: {
  name: string;
  insights_md?: string | null;
  amenities?: string[];
  portfolio_sf?: number | null;
  buildings_owned?: number | null;
  avg_asking_rent?: number | null;
  notable_tenants?: string[];
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
}): Promise<Landlord> {
  const db = sql();
  const rows = (await db(
    `INSERT INTO landlords (name, insights_md, amenities, portfolio_sf, buildings_owned,
                            avg_asking_rent, notable_tenants, contact_name, contact_email, contact_phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (name) DO UPDATE SET
       insights_md     = COALESCE(EXCLUDED.insights_md, landlords.insights_md),
       amenities       = CASE WHEN cardinality(EXCLUDED.amenities) > 0
                              THEN EXCLUDED.amenities ELSE landlords.amenities END,
       portfolio_sf    = COALESCE(EXCLUDED.portfolio_sf, landlords.portfolio_sf),
       buildings_owned = COALESCE(EXCLUDED.buildings_owned, landlords.buildings_owned),
       avg_asking_rent = COALESCE(EXCLUDED.avg_asking_rent, landlords.avg_asking_rent),
       notable_tenants = CASE WHEN cardinality(EXCLUDED.notable_tenants) > 0
                              THEN EXCLUDED.notable_tenants ELSE landlords.notable_tenants END,
       contact_name    = COALESCE(EXCLUDED.contact_name, landlords.contact_name),
       contact_email   = COALESCE(EXCLUDED.contact_email, landlords.contact_email),
       contact_phone   = COALESCE(EXCLUDED.contact_phone, landlords.contact_phone)
     RETURNING *`,
    [
      input.name,
      input.insights_md ?? null,
      input.amenities ?? [],
      input.portfolio_sf ?? null,
      input.buildings_owned ?? null,
      input.avg_asking_rent ?? null,
      input.notable_tenants ?? [],
      input.contact_name ?? null,
      input.contact_email ?? null,
      input.contact_phone ?? null,
    ],
  )) as any[];
  return rows[0] as Landlord;
}

export async function getSpaceImages(spaceId: string) {
  const db = sql();
  return (await db(
    `SELECT * FROM space_images WHERE space_id = $1 ORDER BY sort_order, uploaded_at`,
    [spaceId],
  )) as any[];
}

export async function addSpaceImage(spaceId: string, blobUrl: string, caption: string | null) {
  const db = sql();
  const rows = (await db(
    `INSERT INTO space_images (space_id, blob_url, caption, sort_order)
     VALUES ($1,$2,$3, COALESCE((SELECT MAX(sort_order)+1 FROM space_images WHERE space_id = $1), 0))
     RETURNING *`,
    [spaceId, blobUrl, caption],
  )) as any[];
  return rows[0];
}

/**
 * Rewrites captions and order for a space's photos in one round trip. Scoped
 * to the space, so a stale id from another space silently does nothing rather
 * than reordering someone else's gallery.
 */
export async function updateSpaceImages(
  spaceId: string,
  images: { id: string; caption: string | null; sort_order: number }[],
) {
  const db = sql();
  for (const img of images) {
    await db(
      `UPDATE space_images SET caption = $1, sort_order = $2
        WHERE id = $3 AND space_id = $4`,
      [img.caption, img.sort_order, img.id, spaceId],
    );
  }
  return getSpaceImages(spaceId);
}

/** Creates the schema. Safe to call repeatedly. */
export async function ensureSchema(schemaSql: string) {
  const db = sql();
  await db(schemaSql);
}
