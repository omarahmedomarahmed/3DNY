/**
 * A development dataset, so the map can be driven without the live database.
 *
 *   npx tsx scripts/make-dev-fixture.ts --live      # the real market, preferred
 *   npx tsx scripts/make-dev-fixture.ts --live --with-tenants
 *   npx tsx scripts/make-dev-fixture.ts             # synthetic, offline fallback
 *
 * The production map reads Neon. A development container has no connection
 * string and no way to get one, which would leave every browser harness and
 * every screenshot in this project unrunnable — and the Explore mode work is
 * judged almost entirely on what it looks like.
 *
 * So this writes `fixtures/dev-buildings.json`, which `/api/buildings` serves
 * **only** when `SPACES_FIXTURE_DB=1` is set. It is never on in production and
 * never on by default.
 *
 * Two modes, and `--live` is the one to use:
 *
 * | Mode | Where the data comes from |
 * |---|---|
 * | `--live` | The deployed app's own `/api/buildings`, which reads the real Neon database. 73 buildings, 312 real availabilities, real landlords, provenance intact |
 * | default | Real NYC Open Data geometry with **invented** availability rows on top |
 *
 * The `--live` route needs no credentials: the map is served without a sign-in,
 * deliberately, so its read-only API is reachable. It is a **read**, and the
 * only one this script has ever made — nothing here writes to a database in
 * either mode.
 *
 * **The output is gitignored**, and that is not incidental. In `--live` mode
 * `fixtures/dev-buildings.json` holds real landlord availability with real
 * asking rents, and a snapshot of a live market does not belong in a git
 * history where it will still be sitting, silently stale, in a year. Same rule
 * as `public/lod2/massing.json`: cheap to regenerate, never committed.
 *
 * In the synthetic mode every invented row is stamped FIXTURE in its notes and
 * carries a fixture import filename, so it cannot be mistaken for a landlord
 * feed at a glance or in a screenshot.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const FOOTPRINTS = 'https://data.cityofnewyork.us/resource/5zhs-2jue.json';
const PLUTO = 'https://data.cityofnewyork.us/resource/64uk-42ks.json';
const OUT = 'fixtures/dev-buildings.json';

const args = process.argv.slice(2);
const value = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

/** Read the real market rather than synthesising one. */
const LIVE = args.includes('--live') || Boolean(value('live'));
/**
 * Whether to stamp synthetic tenancy onto the live snapshot.
 *
 * The real database holds no tenants — 73 buildings, 312 availabilities, zero
 * tenancy rows — which is a true statement about the market data and leaves
 * three of `verify-occupancy`'s checks with nothing to act on. This flag adds
 * tenancy, and only tenancy: every availability, rent, landlord and provenance
 * field in the snapshot stays exactly as the live API returned it.
 *
 * Every invented row is stamped FIXTURE in its notes, the same as in synthetic
 * mode, and the output is gitignored either way. It is a development
 * convenience for a harness, and it is never a fallback for a database that
 * failed.
 */
const WITH_TENANTS = args.includes('--with-tenants');

/**
 * The deployed app to read from.
 *
 * Defaults to the production alias rather than a preview: previews come and go
 * with branches, and a fixture regenerated from a branch that has since been
 * deleted fails with a 404 that looks like a network problem.
 */
const LIVE_URL =
  value('live') ??
  'https://cresa-git-main-omarabdelgawad001-4055s-projects.vercel.app';

const FIXTURE_NOTE =
  'FIXTURE — synthetic development data. Not a listing, not from a landlord feed.';

/** One seed row: everything real, plus the availability we invent on top. */
interface Seed {
  address: string;
  name: string | null;
  lon: number;
  lat: number;
  submarket: string;
  cluster: string;
  klass: 'A' | 'B' | 'C';
  landlord: string;
  /** [floor, SF, rent psf or null for withheld, 'entire' | 'partial'] */
  spaces: [number, number, number | null, 'entire' | 'partial'][];
  /** [company, floors as written, floor numbers, relationship] */
  tenants?: [string, string, number[], 'occupier' | 'prospect' | 'client'][];
}

/**
 * Twelve real Manhattan towers. Chosen for the three heroes named in the plan
 * plus enough neighbours that a street-level frame has a city in it, and
 * 100 Park Avenue because every existing browser harness drives the map
 * through it by name.
 */
const SEEDS: Seed[] = [
  {
    address: '350 Fifth Avenue',
    name: 'Empire State Building',
    lon: -73.98566, lat: 40.74844,
    submarket: 'Midtown', cluster: 'Penn Plaza/Garment', klass: 'A',
    landlord: 'Empire State Realty Trust',
    spaces: [[14, 24_500, 78, 'entire'], [63, 9_800, 96, 'partial'], [32, 18_200, null, 'entire']],
    tenants: [
      ['Harlan Media Group', '40-44', [40, 41, 42, 43, 44], 'occupier'],
      ['Vance Kerr Realty', '21', [21], 'client'],
    ],
  },
  {
    address: '285 Fulton Street',
    name: 'One World Trade Center',
    lon: -74.01337, lat: 40.71274,
    submarket: 'Downtown', cluster: 'World Trade Center', klass: 'A',
    landlord: 'The Durst Organization',
    spaces: [[64, 32_400, 105, 'entire'], [22, 14_100, 88, 'partial']],
  },
  {
    address: '1 Battery Park Plaza',
    name: 'One Battery Park Plaza',
    lon: -74.01360, lat: 40.70420,
    submarket: 'Downtown', cluster: 'Financial District', klass: 'B',
    landlord: 'Rudin Management',
    spaces: [[9, 15_600, 58, 'entire'], [14, 7_300, 62, 'partial']],
  },
  {
    address: '100 Park Avenue',
    name: null,
    lon: -73.97960, lat: 40.75130,
    submarket: 'Midtown', cluster: 'Grand Central', klass: 'A',
    landlord: 'SL Green Realty',
    spaces: [[14, 21_900, 92, 'entire'], [26, 11_400, 98, 'partial'], [8, 19_050, 84, 'entire']],
    // `verify-occupancy` searches for "Kestrel" and expects to land on
    // 100 Park Avenue, so the fixture has to carry a tenancy by that name.
    tenants: [
      ['Kestrel Analytics Group', '20-23', [20, 21, 22, 23], 'client'],
      ['Example Law Partners LLP', '4-7', [4, 5, 6, 7], 'occupier'],
      ['Northbridge Consumer Brands', '30-31', [30, 31], 'occupier'],
    ],
  },
  // Three more on the same two blocks as 100 Park Avenue. `verify-map-chrome`
  // frames that tower and then needs a SECOND building on screen to click, to
  // prove a pinned card survives the next one opening — so the fixture has to
  // have neighbours, not just a scatter of towers across the island.
  {
    address: '90 Park Avenue',
    name: null,
    lon: -73.97930, lat: 40.75220,
    submarket: 'Midtown', cluster: 'Grand Central', klass: 'A',
    landlord: 'Vornado Realty Trust',
    spaces: [[19, 16_400, 89, 'entire'], [14, 9_700, 91, 'partial']],
  },
  {
    address: '101 Park Avenue',
    name: null,
    lon: -73.97860, lat: 40.75090,
    submarket: 'Midtown', cluster: 'Grand Central', klass: 'A',
    landlord: 'H.J. Kalikow & Co.',
    spaces: [[34, 20_800, 96, 'entire']],
  },
  {
    address: '110 East 42nd Street',
    name: 'Bowery Savings Bank Building',
    lon: -73.97800, lat: 40.75210,
    submarket: 'Midtown', cluster: 'Grand Central', klass: 'B',
    landlord: 'The Feil Organization',
    spaces: [[12, 6_900, 71, 'partial']],
  },
  {
    address: '200 Park Avenue',
    name: 'MetLife Building',
    lon: -73.97635, lat: 40.75434,
    submarket: 'Midtown', cluster: 'Grand Central', klass: 'A',
    landlord: 'Tishman Speyer',
    spaces: [[41, 28_700, 118, 'entire'], [14, 12_300, 104, 'partial']],
  },
  {
    address: '1 Bryant Park',
    name: 'Bank of America Tower',
    lon: -73.98455, lat: 40.75565,
    submarket: 'Midtown', cluster: 'Times Square', klass: 'A',
    landlord: 'The Durst Organization',
    spaces: [[38, 26_100, 132, 'entire']],
  },
  {
    address: '30 Rockefeller Plaza',
    name: 'Comcast Building',
    lon: -73.97870, lat: 40.75870,
    submarket: 'Midtown', cluster: 'Rockefeller Center', klass: 'A',
    landlord: 'Tishman Speyer',
    spaces: [[52, 17_800, 126, 'partial'], [14, 23_400, 112, 'entire']],
  },
  {
    address: '55 Water Street',
    name: null,
    lon: -74.00790, lat: 40.70310,
    submarket: 'Downtown', cluster: 'Financial District', klass: 'B',
    landlord: 'Retirement Systems of Alabama',
    spaces: [[27, 41_200, 56, 'entire'], [12, 22_700, null, 'entire']],
  },
  {
    address: '601 Lexington Avenue',
    name: 'Citigroup Center',
    lon: -73.97180, lat: 40.75870,
    submarket: 'Midtown', cluster: 'Plaza District', klass: 'A',
    landlord: 'Boston Properties',
    spaces: [[45, 19_600, 121, 'entire'], [14, 8_900, 108, 'partial']],
  },
  {
    address: '4 Times Square',
    name: null,
    lon: -73.98622, lat: 40.75612,
    submarket: 'Midtown', cluster: 'Times Square', klass: 'A',
    landlord: 'The Durst Organization',
    spaces: [[29, 33_500, 94, 'entire']],
  },
  {
    address: '1440 Broadway',
    name: null,
    lon: -73.98680, lat: 40.75346,
    submarket: 'Midtown', cluster: 'Penn Plaza/Garment', klass: 'B',
    landlord: 'CIM Group',
    spaces: [[14, 43_800, 72, 'entire'], [17, 21_000, 74, 'entire']],
  },
  {
    address: '100 Church Street',
    name: null,
    lon: -74.00988, lat: 40.71230,
    submarket: 'Downtown', cluster: 'Financial District', klass: 'B',
    landlord: 'SL Green Realty',
    spaces: [[21, 18_087, null, 'entire'], [8, 4_170, null, 'partial']],
  },
];

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Largest ring across a BIN's footprint parts — the tower, not the annexe. */
function largestRing(records: any[]): [number, number][] | null {
  let best: { area: number; ring: [number, number][] } | null = null;
  for (const rec of records) {
    const geom = rec.the_geom;
    if (!geom) continue;
    const polygons: any[] =
      geom.type === 'MultiPolygon' ? geom.coordinates
        : geom.type === 'Polygon' ? [geom.coordinates] : [];
    for (const poly of polygons) {
      const ring = poly?.[0];
      if (!Array.isArray(ring) || ring.length < 4) continue;
      let sum = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      }
      const area = Math.abs(sum / 2);
      if (!best || area > best.area) {
        best = { area, ring: ring.map((p: number[]) => [p[0], p[1]] as [number, number]) };
      }
    }
  }
  return best?.ring ?? null;
}

async function getJson(url: string): Promise<any[]> {
  const token = process.env.NYC_OPEN_DATA_APP_TOKEN;
  const res = await fetch(url, { headers: token ? { 'X-App-Token': token } : {} });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return (await res.json()) as any[];
}

/**
 * The real market, straight from the deployed app.
 *
 * `/api/buildings` returns exactly what the map itself consumes —
 * `BuildingWithSpaces[]`, footprints joined, rents and provenance intact — so
 * the fixture is not a reconstruction of the live data, it IS the live data
 * as the map sees it. Nothing is reshaped, because every reshaping is a place
 * the fixture could diverge from what a broker actually looks at.
 */
interface LiveBuilding {
  id?: string;
  address_display: string;
  bin: string | null;
  footprint: unknown;
  num_floors?: number | null;
  spaces?: { floor_number?: number | null }[];
  tenants?: unknown[];
}

/**
 * Tenancy for the buildings the live data has none for.
 *
 * Deterministic — the same building gets the same tenants every time it is
 * regenerated, so a harness that passes today passes tomorrow. Placed on
 * floors that carry no availability, because a floor that is both let and on
 * the market is a contradiction a broker would notice immediately.
 *
 * The names are obviously invented and the relationship mix is fixed: one in
 * four is a Cresa client, so the client band has something to draw.
 */
const FIXTURE_COMPANIES = [
  'Harlan & Wren', 'Meridian Partners', 'Kestrel Analytics', 'Bayard Group',
  'Ostrom Capital', 'Fennimore Studio', 'Clearwater Legal', 'Arbor Health',
  'Linden & Cole', 'Pemberton Advisory', 'Ravenscroft Media', 'Solent Systems',
];

function addFixtureTenants(buildings: LiveBuilding[]): void {
  const now = new Date().toISOString();

  buildings.forEach((b, bi) => {
    if ((b.tenants?.length ?? 0) > 0) return;
    const floors = Math.max(1, b.num_floors ?? 0);
    if (floors < 3) return;

    const taken = new Set(
      (b.spaces ?? [])
        .map((s) => s.floor_number ?? 0)
        .filter((n) => n > 0),
    );

    const out: unknown[] = [];
    // Three tenancies per building, spread through it rather than stacked at
    // the bottom, and skipping anything that is on the market.
    for (let k = 0; k < 3; k++) {
      const floor = Math.max(2, Math.round(((k + 1) / 4) * floors));
      if (taken.has(floor)) continue;
      taken.add(floor);
      const company = FIXTURE_COMPANIES[(bi * 3 + k) % FIXTURE_COMPANIES.length];
      out.push({
        id: `fx-tenant-${b.bin ?? bi}-${k}`,
        building_id: b.id ?? null,
        company_name: company,
        floors: String(floor),
        floor_numbers: [floor],
        suite: null,
        sf: null,
        lease_start: null,
        lease_expiration: null,
        industry: null,
        notes: FIXTURE_NOTE,
        relationship: k === 1 ? 'client' : 'occupier',
        source: 'manual',
        salesforce_id: null,
        field_sources: {},
        updated_at: now,
      });
    }
    b.tenants = out;
  });
}

async function fetchLive(): Promise<void> {
  const url = `${LIVE_URL.replace(/\/$/, '')}/api/buildings`;
  console.log(`Reading the live market from ${url}`);

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(
      `${res.status} from ${url}. The deployment may have been renamed or ` +
        'removed; pass --live=<base-url> with a current one.',
    );
  }

  const buildings = (await res.json()) as LiveBuilding[];

  if (!Array.isArray(buildings) || buildings.length === 0) {
    throw new Error('The live API returned no buildings. Refusing to write an empty fixture.');
  }

  if (WITH_TENANTS) addFixtureTenants(buildings as LiveBuilding[]);

  const spaces = buildings.reduce((n, b) => n + (b.spaces?.length ?? 0), 0);
  const tenants = buildings.reduce((n, b) => n + (b.tenants?.length ?? 0), 0);
  const withBin = buildings.filter((b) => b.bin).length;
  const withRing = buildings.filter((b) => b.footprint).length;

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: url,
        note:
          'A read-only snapshot of the live market, for local development. ' +
          'Real landlord availability — gitignored, and regenerated rather than committed.',
        buildings,
      },
      null,
      1,
    ),
  );

  console.log(
    `\nWrote ${OUT} — ${buildings.length} buildings, ${spaces} spaces, ` +
      `${tenants} tenancies.\n` +
      `${withBin} carry a BIN and ${withRing} a footprint, which is what the ` +
      'surveyed massing and the floor bands both need.',
  );
}

async function main() {
  if (LIVE) {
    await fetchLive();
    return;
  }

  const now = new Date().toISOString();
  const buildings: unknown[] = [];

  for (const seed of SEEDS) {
    /**
     * The tallest footprint within 120 m of the seed point.
     *
     * A point-in-polygon test is the precise answer and the wrong one here:
     * coordinates read off a map pin land in the street about half the time,
     * and when they do land inside a plot it is as often the two-storey annexe
     * as the tower. On a Manhattan block the tallest thing within 120 m of the
     * address IS the building the address means, every time in this set.
     */
    const near = await getJson(
      `${FOOTPRINTS}?$where=within_circle(the_geom,${seed.lat},${seed.lon},120)&$limit=120`,
    );
    const hits = near
      .filter((r) => (num(r.height_roof) ?? 0) > 0)
      .sort((a, b) => (num(b.height_roof) ?? 0) - (num(a.height_roof) ?? 0))
      .slice(0, 1);
    if (hits.length === 0) {
      console.warn(`  ${seed.address}: no footprint within 120 m, skipping`);
      continue;
    }

    const bin: string = hits[0].bin;
    const bbl: string | null = hits[0].base_bbl ?? null;
    const parts = await getJson(`${FOOTPRINTS}?bin=${encodeURIComponent(bin)}&$limit=25`);
    const ring = largestRing(parts.length > 0 ? parts : hits);
    const heights = parts
      .map((r) => num(r.height_roof))
      .filter((h): h is number => h !== null);

    let numFloors: number | null = null;
    let yearBuilt: number | null = null;
    let areaSf: number | null = null;
    if (bbl) {
      const pluto = await getJson(`${PLUTO}?bbl=${encodeURIComponent(bbl)}&$limit=1`);
      if (pluto.length > 0) {
        const f = num(pluto[0].numfloors);
        numFloors = f !== null && f > 0 ? Math.round(f) : null;
        yearBuilt = num(pluto[0].yearbuilt);
        areaSf = num(pluto[0].bldgarea);
      }
    }

    const id = `fx-${bin}`;
    const spaces = seed.spaces.map(([floor, sf, rent, portion], i) => ({
      id: `fx-space-${bin}-${i}`,
      building_id: id,
      floor_number: floor,
      floor_label: portion === 'entire' ? `Entire ${floor}` : `Partial ${floor}`,
      floor_portion: portion,
      sf,
      asking_rent_psf: rent,
      asking_rent_withheld: rent === null,
      space_use: 'Office',
      lease_type: 'direct',
      sub_landlord: null,
      occupancy_raw: 'Vacant',
      available_from: null,
      term_raw: 'Negotiable',
      term_expires: null,
      leasing_company: seed.landlord,
      agent_name: null,
      agent_email: null,
      agent_email_suspect: false,
      date_added: now.slice(0, 10),
      source_import_id: 'dev-fixture',
      import_filename: 'dev-fixture.json',
      import_uploaded_at: now,
      import_source_kind: 'fixture',
      import_source_url: null,
      notes: FIXTURE_NOTE,
      is_active: true,
      updated_at: now,
    }));

    const tenants = (seed.tenants ?? []).map(([company, floors, numbers, relationship], i) => ({
      id: `fx-tenant-${bin}-${i}`,
      building_id: id,
      company_name: company,
      floors,
      floor_numbers: numbers,
      suite: null,
      sf: null,
      lease_start: null,
      lease_expiration: null,
      industry: null,
      notes: FIXTURE_NOTE,
      relationship,
      source: 'manual',
      salesforce_id: null,
      field_sources: {},
      updated_at: now,
    }));

    const rents = spaces
      .map((s) => s.asking_rent_psf)
      .filter((r): r is number => r !== null);

    buildings.push({
      id,
      bin,
      bbl,
      address_normalized: seed.address.toUpperCase(),
      address_display: seed.address,
      building_name: seed.name,
      landlord_id: null,
      landlord_name: seed.landlord,
      class: seed.klass,
      submarket: seed.submarket,
      submarket_cluster: seed.cluster,
      num_floors: numFloors,
      height_roof_ft: heights.length > 0 ? Math.max(...heights) : null,
      year_built: yearBuilt,
      bldg_area_sf: areaSf,
      lon: seed.lon,
      lat: seed.lat,
      footprint: ring,
      match_confidence: 'exact',
      floor_height_override: null,
      notes: FIXTURE_NOTE,
      field_sources: {},
      updated_at: now,
      spaces,
      tenants,
      minRent: rents.length > 0 ? Math.min(...rents) : null,
      maxRent: rents.length > 0 ? Math.max(...rents) : null,
      totalAvailableSf: spaces.reduce((n, s) => n + (s.sf ?? 0), 0),
      spaceCount: spaces.length,
    });

    console.log(
      `  ${seed.address}: BIN ${bin}, ${ring?.length ?? 0} ring points, ` +
      `${heights.length ? Math.max(...heights).toFixed(0) : '?'} ft, ${numFloors ?? '?'} floors`,
    );
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify({ generatedAt: now, note: FIXTURE_NOTE, buildings }, null, 1),
  );
  console.log(`\nWrote ${OUT} — ${buildings.length} buildings.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
