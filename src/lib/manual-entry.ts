import { sql, normalizeAddress } from '@/lib/db';
import { geocodeAddress } from '@/lib/address-matcher';
import { enrichBuildingGeometry, upsertBuilding } from '@/lib/queries';
import { parseFloor, parseSf, parseAskingRent } from '@/lib/csv-parser';
import type { Building, FloorPortion, LeaseType, Space } from '@/types';

/**
 * Adding one building, or one space, without a spreadsheet.
 *
 * The importer assumes a sheet. Most weeks that is right — a weekly
 * availability file is how this inventory actually moves — but it makes the
 * smallest possible task the most awkward one: hearing about a single floor in
 * a meeting meant opening a spreadsheet, writing one row with the right eleven
 * headers, saving it, and uploading it. Nobody does that during a call, so the
 * floor goes in a notebook and reaches the map on Friday, if at all.
 *
 * So this is the same pipeline with the file taken out. An address goes
 * through the same geocoder, produces the same BIN, gets the same footprint
 * and roof height from the same city datasets, and lands in the same tables.
 * A hand-added building is not a lesser kind of building.
 *
 * Two decisions worth stating:
 *
 * **A building may exist with no space in it.** That is the point of being
 * able to add one: you know the tower before you know what is available in it,
 * and recording it lets tenants, landlord notes and the next availability
 * attach to something real rather than waiting for a sheet.
 *
 * **An address is the key, not a dropdown.** Adding a space asks for the
 * address, exactly as the sheet does, and resolves it the same way. Asking
 * someone to find a building in a list first is asking them to already know
 * whether it is there.
 */

export interface ResolvedAddress {
  /** The building this address is, when we already have it. */
  building: Building | null;
  confidence: string;
  bin: string | null;
  bbl: string | null;
  lon: number | null;
  lat: number | null;
  resolvedAddress: string | null;
  explanation: string;
}

/** Loads a building by id, in the shape the rest of the app expects. */
async function buildingById(id: string): Promise<Building | null> {
  const db = sql();
  const rows = (await db(
    `SELECT b.id, b.bin, b.bbl, b.address_normalized, b.address_display, b.building_name,
            b.landlord_id, b.class, b.submarket, b.submarket_cluster, b.num_floors,
            b.height_roof_ft, b.year_built, b.bldg_area_sf,
            ST_X(b.centroid::geometry) AS lon, ST_Y(b.centroid::geometry) AS lat,
            b.match_confidence, b.floor_height_override, b.notes, b.updated_at
     FROM buildings b WHERE b.id = $1`,
    [id],
  )) as Record<string, unknown>[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    ...r,
    lon: r.lon === null ? null : Number(r.lon),
    lat: r.lat === null ? null : Number(r.lat),
    height_roof_ft: r.height_roof_ft === null ? null : Number(r.height_roof_ft),
    bldg_area_sf: r.bldg_area_sf === null ? null : Number(r.bldg_area_sf),
    floor_height_override:
      r.floor_height_override === null ? null : Number(r.floor_height_override),
    footprint: null,
  } as unknown as Building;
}

/**
 * What an address is, before anything is created.
 *
 * This is what the form calls as you type, so the answer can be shown before
 * anyone commits: "this is 100 Park Avenue, which you already have" or "this
 * resolves to BIN 1024563 and would be new". Creating a duplicate building
 * because two people wrote the same tower two ways is the failure this is
 * here to prevent, and the fix is showing the match rather than trusting it.
 */
export async function resolveAddress(address: string): Promise<ResolvedAddress> {
  const db = sql();

  /**
   * One address, so it can afford to wait.
   *
   * The default deadline is tuned for an import geocoding a hundred addresses
   * at once, where a slow service turns seconds into minutes. This is a single
   * lookup somebody has explicitly asked for by typing an address, and
   * Geosearch routinely takes five to nine seconds. Timing out at four told
   * them a real building did not exist and sent them to pick it off the map by
   * hand — which is a worse thing to do to them than making them wait.
   */
  const match = await geocodeAddress(address, { timeoutMs: 10_000 });

  // Both spellings: the one typed and the one the city returned. A building
  // created from a sheet is keyed on whichever of those the sheet used, so
  // checking only one of them finds it only half the time.
  const keys = [normalizeAddress(address)];
  if (match.resolvedAddress) {
    const resolved = normalizeAddress(match.resolvedAddress);
    if (!keys.includes(resolved)) keys.push(resolved);
  }

  let existing: string | null = null;
  const byAddress = (await db(
    `SELECT id FROM buildings WHERE address_normalized = ANY($1) LIMIT 1`,
    [keys],
  )) as { id: string }[];
  if (byAddress.length > 0) existing = byAddress[0].id;

  // A BIN is the stronger key: it catches "60 E 42nd St" against
  // "60 East 42nd Street - One Grand Central Place", which no amount of string
  // normalising will.
  if (!existing && match.bin) {
    const byBin = (await db(`SELECT id FROM buildings WHERE bin = $1 LIMIT 1`, [
      match.bin,
    ])) as { id: string }[];
    if (byBin.length > 0) existing = byBin[0].id;
  }

  return {
    building: existing ? await buildingById(existing) : null,
    confidence: match.confidence,
    bin: match.bin,
    bbl: match.bbl,
    lon: match.lon,
    lat: match.lat,
    resolvedAddress: match.resolvedAddress,
    explanation: match.explanation,
  };
}

export interface CreateBuildingInput {
  address: string;
  buildingName?: string | null;
  class?: 'A' | 'B' | 'C' | null;
  submarketCluster?: string | null;
  notes?: string | null;
}

/**
 * Creates a building from an address, or returns the one that is already there.
 *
 * Geometry is fetched immediately rather than left for a later backfill: a
 * building added by hand that draws as a grey box until somebody remembers to
 * run an enrichment is a building nobody trusts. Best-effort — a city dataset
 * being slow must not lose the building.
 */
export async function createBuildingFromAddress(input: CreateBuildingInput): Promise<{
  building: Building;
  created: boolean;
  geometryNote: string | null;
}> {
  const resolved = await resolveAddress(input.address);

  if (resolved.building) {
    return { building: resolved.building, created: false, geometryNote: null };
  }

  if (resolved.confidence === 'unmatched') {
    throw new Error(
      `That address could not be found. ${resolved.explanation} ` +
        'Check the street number and spelling, or import a sheet containing it and ' +
        'pick the building on the map once.',
    );
  }

  const id = await upsertBuilding({
    addressDisplay: input.address.trim(),
    buildingName: input.buildingName?.trim() || null,
    bin: resolved.bin,
    bbl: resolved.bbl,
    lon: resolved.lon,
    lat: resolved.lat,
    class: input.class ?? null,
    submarket: null,
    submarketCluster: input.submarketCluster?.trim() || null,
    matchConfidence: resolved.confidence,
  });

  let geometryNote: string | null = null;
  try {
    geometryNote = await enrichBuildingGeometry(id, resolved.bin, resolved.bbl);
  } catch (err) {
    geometryNote = `Footprint lookup failed (${(err as Error).message}). ` +
      'The building is saved; run "Refresh building shapes" on Setup to try again.';
  }

  if (input.notes?.trim()) {
    const db = sql();
    await db(`UPDATE buildings SET notes = $2 WHERE id = $1`, [id, input.notes.trim()]);
  }

  const building = await buildingById(id);
  if (!building) throw new Error('The building was created but could not be read back.');
  return { building, created: true, geometryNote };
}

export interface CreateSpaceInput {
  buildingId: string;
  /** As typed: "14", "Partial 45th", "Entire 8". Parsed the sheet's way. */
  floor: string;
  sf?: string | number | null;
  askingRent?: string | number | null;
  spaceUse?: string | null;
  leaseType?: LeaseType | null;
  availableFrom?: string | null;
  termExpires?: string | null;
  leasingCompany?: string | null;
  notes?: string | null;
}

/**
 * Adds one available space to a building.
 *
 * The floor is parsed by the same function the importer uses, so "Partial
 * 45th" typed here means exactly what it means on a sheet — the same portion,
 * the same floor number, the same band on the tower. Two parsers would be two
 * behaviours, and the one used less often would be the one that was wrong.
 */
export async function createSpace(input: CreateSpaceInput): Promise<Space> {
  const db = sql();
  const floor = parseFloor(input.floor ?? '');
  if (!floor.label) throw new Error('A floor is required — "14", "Partial 45th", "Entire 8".');

  const sf =
    typeof input.sf === 'number'
      ? input.sf
      : parseSf(String(input.sf ?? ''));

  const rent =
    typeof input.askingRent === 'number'
      ? { psf: input.askingRent, withheld: false }
      // Blank means withheld, which is what the sheet means by it and roughly
      // half of all listings. It is never zero.
      : parseAskingRent(String(input.askingRent ?? ''));

  const rows = (await db(
    `INSERT INTO spaces (
       building_id, floor_number, floor_label, floor_portion, sf,
       asking_rent_psf, asking_rent_withheld, space_use, lease_type,
       available_from, term_expires, leasing_company, notes, date_added, is_active
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_DATE,true)
     ON CONFLICT (building_id, floor_label, COALESCE(sf, -1), COALESCE(date_added, '1900-01-01'))
     DO UPDATE SET
       asking_rent_psf      = EXCLUDED.asking_rent_psf,
       asking_rent_withheld = EXCLUDED.asking_rent_withheld,
       space_use            = EXCLUDED.space_use,
       lease_type           = EXCLUDED.lease_type,
       available_from       = EXCLUDED.available_from,
       term_expires         = EXCLUDED.term_expires,
       leasing_company      = EXCLUDED.leasing_company,
       notes                = EXCLUDED.notes,
       is_active            = true
     RETURNING *`,
    [
      input.buildingId,
      floor.number,
      floor.label,
      floor.portion,
      sf,
      rent.psf,
      rent.withheld,
      input.spaceUse?.trim() || null,
      input.leaseType ?? null,
      input.availableFrom || null,
      input.termExpires || null,
      input.leasingCompany?.trim() || null,
      input.notes?.trim() || null,
    ],
  )) as Record<string, unknown>[];

  return rows[0] as unknown as Space;
}

export type { FloorPortion };
