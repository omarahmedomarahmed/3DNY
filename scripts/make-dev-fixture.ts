/**
 * A development dataset, so the map can be driven without the live database.
 *
 *   npx tsx scripts/make-dev-fixture.ts
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
 * What is real here and what is not, stated plainly:
 *
 * | Field | Source |
 * |---|---|
 * | BIN, footprint ring, roof height, ground elevation | NYC Building Footprints `5zhs-2jue` — real |
 * | Floor count, year built, building area | MapPLUTO `64uk-42ks` — real |
 * | Address, coordinates | Real |
 * | Floors available, SF, asking rent, landlord | **Invented.** Development scaffolding |
 *
 * Every invented row is stamped FIXTURE in its notes and carries a fixture
 * import filename, so it cannot be mistaken for a landlord feed at a glance or
 * in a screenshot. Nothing here is ever written to a database.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const FOOTPRINTS = 'https://data.cityofnewyork.us/resource/5zhs-2jue.json';
const PLUTO = 'https://data.cityofnewyork.us/resource/64uk-42ks.json';
const OUT = 'fixtures/dev-buildings.json';

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

async function main() {
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
