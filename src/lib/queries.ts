import { sql, normalizeAddress } from '@/lib/db';
import { fieldSourceAssignment } from '@/lib/field-stamp';
import { parseFloorList } from '@/lib/floor-list';
import type {
  Building,
  BuildingWithSpaces,
  FieldSources,
  Landlord,
  MatchedRow,
  Space,
  Tenant,
  TenantRelationship,
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

function toTenant(r: any): Tenant {
  return {
    id: r.id,
    building_id: r.building_id,
    company_name: r.company_name,
    floors: r.floors ?? null,
    // Postgres hands an integer[] back as an array; a row written before the
    // column existed has null. Either way the map needs a list it can loop.
    floor_numbers: Array.isArray(r.floor_numbers) ? r.floor_numbers.map(Number) : [],
    suite: r.suite ?? null,
    sf: r.sf === null || r.sf === undefined ? null : Number(r.sf),
    lease_start: r.lease_start ?? null,
    lease_expiration: r.lease_expiration ?? null,
    industry: r.industry ?? null,
    notes: r.notes ?? null,
    relationship: r.relationship ?? 'occupier',
    source: r.source ?? 'manual',
    salesforce_id: r.salesforce_id ?? null,
    salesforce_url: r.salesforce_url ?? null,
    source_import_id: r.source_import_id ?? null,
    import_filename: r.import_filename ?? null,
    last_synced_at: r.last_synced_at ?? null,
    field_sources: toFieldSources(r.field_sources),
    updated_at: r.updated_at,
  };
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
    import_source_kind: r.import_source_kind ?? null,
    import_source_url: r.import_source_url ?? null,
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
    db(`SELECT s.*, i.filename AS import_filename, i.uploaded_at AS import_uploaded_at,
               i.source_kind AS import_source_kind, i.source_url AS import_source_url
        FROM spaces s LEFT JOIN imports i ON i.id = s.source_import_id
        WHERE s.is_active ORDER BY s.floor_number NULLS LAST`),
    // The roster is joined in for the same reason the availability sheet is:
    // a tenancy on the map has to be able to say where it came from without a
    // second request.
    db(`SELECT t.*, i.filename AS import_filename
        FROM tenants t LEFT JOIN imports i ON i.id = t.source_import_id
        ORDER BY t.company_name`),
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
    list.push(toTenant(row));
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
  /**
   * What told us this building exists. Defaults to `sheet`, which is where
   * every building came from until the landlord loader.
   *
   * Only the fields whose value the source actually supplied get stamped —
   * address, name, class, submarket. The BIN, the outline and the floor count
   * still come from the city whatever created the row, and must keep saying
   * so.
   */
  sourceKind?: string;
}): Promise<string> {
  const db = sql();
  const normalized = normalizeAddress(input.addressDisplay);
  const point =
    input.lon !== null && input.lat !== null
      ? `SRID=4326;POINT(${input.lon} ${input.lat})`
      : null;

  /**
   * "Off a sheet" is what the resolver assumes for these fields, so a building
   * that came from somewhere else has to say so on the row. Written only for a
   * non-sheet source, so the ordinary import keeps stamping nothing and the
   * popover keeps naming the sheet by filename.
   *
   * The merge below puts the EXISTING stamp on the right of `||`, so it wins.
   * That is the whole design in one operator: this fills in a field carrying
   * no stamp and can never overwrite one that has — including a `manual`
   * stamp, which outranks every source in this app. It also means a building
   * already on the map picks up its provenance the next time the loader runs,
   * rather than needing a migration.
   *
   * One imprecision, stated because it is not obvious: no stamp is how the
   * resolver spells "off a sheet". So a building first created by a sheet and
   * later seen in a landlord feed comes out credited to the landlord. It is
   * not a false claim — the landlord does publish that address for that
   * building — but it is a coarser answer than the row-level provenance on
   * the spaces, which stays exact per listing.
   */
  const supplied: [string, unknown][] = [
    ['address_display', input.addressDisplay],
    ['building_name', input.buildingName],
    ['class', input.class],
    ['submarket', input.submarket],
    ['submarket_cluster', input.submarketCluster],
  ];
  const stamp =
    input.sourceKind && input.sourceKind !== 'sheet'
      ? Object.fromEntries(
          supplied
            // Only what this source actually said. A landlord page states no
            // building class, so stamping `class` put "read off the landlord's
            // page" beside a value that page never mentioned — a marker
            // claiming a source for a field its source is silent on is worse
            // than no marker at all.
            .filter(([, value]) => value !== null && value !== undefined && value !== '')
            .map(([field]) => [field, { kind: input.sourceKind, at: new Date().toISOString() }]),
        )
      : null;

  const rows = (await db(
    `INSERT INTO buildings (
       address_normalized, address_display, building_name, bin, bbl,
       centroid, class, submarket, submarket_cluster, match_confidence, field_sources
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11::jsonb, '{}'::jsonb))
     ON CONFLICT (address_normalized) DO UPDATE SET
       field_sources     = COALESCE($11::jsonb, '{}'::jsonb) || buildings.field_sources,
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
      stamp ? JSON.stringify(stamp) : null,
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
  opts: {
    replaceAll?: boolean;
    /** `sheet` (default) or `landlord` — what the "i" icon will call this. */
    sourceKind?: string;
    /** The public page the figures were read off, for a landlord run. */
    sourceUrl?: string | null;
  } = {},
): Promise<{
  importId: string;
  inserted: number;
  updated: number;
  skipped: number;
  retired: number;
}> {
  const db = sql();

  const importRows = (await db(
    `INSERT INTO imports (filename, market_label, row_count, matched_exact, matched_fuzzy, unmatched, status, source_kind, source_url)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8) RETURNING id`,
    [
      filename,
      marketLabel,
      rows.length,
      rows.filter((r) => r.match.confidence === 'exact').length,
      rows.filter((r) => r.match.confidence === 'fuzzy').length,
      rows.filter((r) => r.match.confidence === 'unmatched').length,
      opts.sourceKind ?? 'sheet',
      opts.sourceUrl ?? null,
    ],
  )) as any[];
  const importId = importRows[0].id as string;

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let retired = 0;

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
        sourceKind: opts.sourceKind,
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

  /**
   * Replace mode: everything this sheet did not carry stops being available.
   *
   * The normal import MERGES, which is right for a weekly sheet — it says what
   * changed, not what exists, and a floor missing from this week's file has
   * usually just not changed. But a full market extract says the opposite:
   * it IS the inventory, and anything absent from it has been leased or
   * withdrawn. Merging one of those leaves last quarter's listings on the map
   * forever, quietly, with nothing to show they are stale.
   *
   * Retired, not deleted. `is_active = false` keeps the row, its photos, its
   * notes and its history — a space that comes back on the market next month
   * is the same space, and a broker who remembers showing it should still be
   * able to find it. Deleting would also cascade to the photographs somebody
   * took, which no import should ever be able to do.
   *
   * Scoped to spaces this run did not touch, so it cannot retire a row the
   * same sheet just wrote.
   */
  if (opts.replaceAll) {
    const retiredRows = (await db(
      `UPDATE spaces SET is_active = false
       WHERE is_active AND (source_import_id IS DISTINCT FROM $1)
       RETURNING id`,
      [importId],
    )) as { id: string }[];
    retired = retiredRows.length;
  }

  await db(`UPDATE imports SET status = 'committed' WHERE id = $1`, [importId]);

  // Pull real footprints for anything newly created. Best-effort: a failed
  // lookup must never lose an import the user already reviewed.
  try {
    await enrichMissingGeometry();
  } catch {
    // Geometry can be backfilled later from Setup.
  }

  return { importId, inserted, updated, skipped, retired };
}

/**
 * Take everything off the market that this run did not carry.
 *
 * `commitImport({ replaceAll })` does the same thing for a single sheet, and
 * that is right when one file is the whole inventory. A landlord run is not
 * one file: it is four separate imports, one per landlord, so that the "i"
 * icon can name the right company and link the right page. Replacing inside
 * each of them would mean the last landlord committed retired the other
 * three.
 *
 * So the retire happens once, after all of them, scoped to the whole run.
 * Same rule as the single-sheet version — `is_active = false`, never a
 * delete, because a floor that comes back next month is the same floor and
 * because deleting would cascade to photographs an import has no business
 * touching.
 *
 * Hand-entered spaces survive. A row with no import behind it was typed by
 * somebody on this team who knew something the feed does not, and a scrape
 * does not get to overrule a person — that is the same rule that makes a
 * `manual` field stamp win over the row's origin everywhere else in the app.
 * They are counted and reported instead, so a run says what it left alone.
 */
export async function retireSpacesOutside(
  importIds: string[],
): Promise<{ retired: number; keptByHand: number }> {
  if (importIds.length === 0) {
    throw new Error('retireSpacesOutside needs at least one import to keep.');
  }
  const db = sql();

  const rows = (await db(
    `UPDATE spaces SET is_active = false
     WHERE is_active
       AND source_import_id IS NOT NULL
       AND NOT (source_import_id = ANY($1::uuid[]))
     RETURNING id`,
    [importIds],
  )) as { id: string }[];

  const kept = (await db(
    `SELECT count(*)::int AS n FROM spaces WHERE is_active AND source_import_id IS NULL`,
  )) as { n: number }[];

  return { retired: rows.length, keptByHand: kept[0]?.n ?? 0 };
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
  'company_name', 'floors', 'suite', 'sf', 'lease_start', 'lease_expiration',
  'industry', 'notes', 'relationship', 'source',
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

/**
 * `floor_numbers` is derived, never sent. Editing the floors text has to move
 * the band on the tower, and leaving that to the caller means one caller
 * eventually forgets and a tenancy silently stops being drawn where it is.
 */
export async function updateTenant(id: string, patch: Record<string, unknown>) {
  const next = { ...patch };
  if ('floors' in next) {
    const floors = typeof next.floors === 'string' ? next.floors : null;
    delete next.floors;
    const db = sql();
    await db(`UPDATE tenants SET floors = $2, floor_numbers = $3 WHERE id = $1`, [
      id,
      floors,
      parseFloorList(floors),
    ]);
    if (Object.keys(next).length === 0) {
      const rows = (await db(`SELECT * FROM tenants WHERE id = $1`, [id])) as any[];
      return rows[0] ? toTenant(rows[0]) : null;
    }
  }
  const row = await patchRow('tenants', TENANT_EDITABLE, id, next);
  return row ? toTenant(row) : null;
}

export const updateLandlord = (id: string, patch: Record<string, unknown>) =>
  patchRow('landlords', LANDLORD_EDITABLE, id, patch);

/** Tenants for one building, or all of them, in the map's own shape. */
export async function getTenants(buildingId: string | null): Promise<Tenant[]> {
  const db = sql();
  const rows = (await db(
    `SELECT t.*, i.filename AS import_filename
     FROM tenants t LEFT JOIN imports i ON i.id = t.source_import_id
     ${buildingId ? 'WHERE t.building_id = $1' : ''}
     ORDER BY t.company_name`,
    buildingId ? [buildingId] : [],
  )) as any[];
  return rows.map(toTenant);
}

export async function createTenant(input: {
  building_id: string;
  company_name: string;
  floors?: string | null;
  suite?: string | null;
  sf?: number | null;
  lease_start?: string | null;
  lease_expiration?: string | null;
  industry?: string | null;
  notes?: string | null;
  relationship?: TenantRelationship;
  source?: string;
  salesforce_id?: string | null;
  salesforce_url?: string | null;
  source_import_id?: string | null;
  last_synced_at?: string | null;
}): Promise<Tenant> {
  const db = sql();
  const rows = (await db(
    `INSERT INTO tenants (
       building_id, company_name, floors, floor_numbers, suite, sf,
       lease_start, lease_expiration, industry, notes, relationship, source,
       salesforce_id, salesforce_url, source_import_id, last_synced_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      input.building_id,
      input.company_name,
      input.floors ?? null,
      // Derived here rather than by the caller, so every path that creates a
      // tenancy — importer, CRM sync, the add-by-hand form — produces a row
      // the map can draw. A tenancy that exists but cannot be drawn because
      // one caller forgot to parse its floors is the failure worth designing
      // out.
      parseFloorList(input.floors),
      input.suite ?? null,
      input.sf ?? null,
      input.lease_start ?? null,
      input.lease_expiration ?? null,
      input.industry ?? null,
      input.notes ?? null,
      input.relationship ?? 'occupier',
      input.source ?? 'manual',
      input.salesforce_id ?? null,
      input.salesforce_url ?? null,
      input.source_import_id ?? null,
      input.last_synced_at ?? null,
    ],
  )) as any[];
  return toTenant(rows[0]);
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
