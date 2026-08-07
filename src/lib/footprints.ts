/**
 * Enriches a matched building with its real geometry and dimensions from NYC
 * Open Data, so the map extrudes the actual footprint rather than a generic box
 * and floor bands sit at a defensible height.
 *
 * Two datasets, both free and keyless (an app token only raises rate limits):
 *   Building Footprints (5zhs-2jue) — polygon, roof height, ground elevation
 *   MapPLUTO           (64uk-42ks) — floor count, year built, area, owner
 *
 * The footprint survey is from a 2014 aerial capture, so post-2014 towers can
 * be missing or short. A missing footprint is reported, never faked.
 */

const FOOTPRINTS = 'https://data.cityofnewyork.us/resource/5zhs-2jue.json';
const PLUTO = 'https://data.cityofnewyork.us/resource/64uk-42ks.json';

export interface FootprintData {
  ring: [number, number][] | null;
  heightRoofFt: number | null;
  groundElevationFt: number | null;
  constructionYear: number | null;
  numFloors: number | null;
  yearBuilt: number | null;
  bldgAreaSf: number | null;
  ownerName: string | null;
  /** Human-readable note about what was and was not found. */
  note: string;
}

function headers(): Record<string, string> {
  const token = process.env.NYC_OPEN_DATA_APP_TOKEN;
  return token ? { 'X-App-Token': token } : {};
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * A BIN can map to several footprint parts (wings, annexes). Take the largest
 * by shape_area — that is the tower a broker means when they say the address.
 */
function largestRing(records: any[]): [number, number][] | null {
  let best: { area: number; ring: [number, number][] } | null = null;

  for (const rec of records) {
    const geom = rec.the_geom;
    if (!geom) continue;

    const polygons: any[] =
      geom.type === 'MultiPolygon' ? geom.coordinates : geom.type === 'Polygon' ? [geom.coordinates] : [];

    for (const poly of polygons) {
      const ring = poly?.[0];
      if (!Array.isArray(ring) || ring.length < 4) continue;
      const area = num(rec.shape_area) ?? ringArea(ring);
      if (!best || area > best.area) {
        best = { area, ring: ring.map((p: number[]) => [p[0], p[1]] as [number, number]) };
      }
    }
  }
  return best?.ring ?? null;
}

/** Shoelace area in degrees². Only used to compare rings against each other. */
function ringArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(sum / 2);
}

export async function fetchFootprint(
  bin: string | null,
  bbl: string | null,
): Promise<FootprintData> {
  const out: FootprintData = {
    ring: null,
    heightRoofFt: null,
    groundElevationFt: null,
    constructionYear: null,
    numFloors: null,
    yearBuilt: null,
    bldgAreaSf: null,
    ownerName: null,
    note: '',
  };
  const notes: string[] = [];

  if (bin) {
    try {
      const res = await fetch(`${FOOTPRINTS}?bin=${encodeURIComponent(bin)}&$limit=25`, {
        headers: headers(),
      });
      if (res.ok) {
        const records = (await res.json()) as any[];
        if (records.length === 0) {
          notes.push(
            `No footprint on file for BIN ${bin} — likely built after the 2014 aerial survey. ` +
              'The building will render as a placeholder until a height is entered by hand.',
          );
        } else {
          out.ring = largestRing(records);
          // Several parts share a BIN; the tallest is the tower.
          const heights = records.map((r) => num(r.height_roof)).filter((h): h is number => h !== null);
          out.heightRoofFt = heights.length ? Math.max(...heights) : null;
          out.groundElevationFt = num(records[0].ground_elevation);
          out.constructionYear = num(records[0].construction_year);
          if (records.length > 1) {
            notes.push(`BIN ${bin} has ${records.length} footprint parts; used the largest.`);
          }
        }
      } else {
        notes.push(`Footprint lookup failed (${res.status}).`);
      }
    } catch (err) {
      notes.push(`Footprint lookup error: ${(err as Error).message}`);
    }
  } else {
    notes.push('No BIN, so no footprint could be looked up.');
  }

  if (bbl) {
    try {
      const res = await fetch(`${PLUTO}?bbl=${encodeURIComponent(bbl)}&$limit=1`, {
        headers: headers(),
      });
      if (res.ok) {
        const rows = (await res.json()) as any[];
        if (rows.length > 0) {
          const r = rows[0];
          const floors = num(r.numfloors);
          out.numFloors = floors !== null && floors > 0 ? Math.round(floors) : null;
          out.yearBuilt = num(r.yearbuilt);
          out.bldgAreaSf = num(r.bldgarea);
          out.ownerName = typeof r.ownername === 'string' ? r.ownername : null;
        } else {
          notes.push(`No PLUTO record for BBL ${bbl}, so floor count is unknown.`);
        }
      }
    } catch (err) {
      notes.push(`PLUTO lookup error: ${(err as Error).message}`);
    }
  }

  out.note = notes.join(' ');
  return out;
}

/**
 * Sanity check before a derived floor height is trusted. Returns the reason a
 * building's floor bands should be treated as approximate, or null when the
 * geometry is solid.
 */
export function floorHeightCaveat(data: {
  heightRoofFt: number | null;
  numFloors: number | null;
}): string | null {
  if (!data.heightRoofFt) return 'No roof height on file — bands use a 12.5 ft default.';
  if (!data.numFloors) return 'No floor count on file — bands use a 12.5 ft default.';
  const perFloor = data.heightRoofFt / data.numFloors;
  if (perFloor < 8 || perFloor > 30) {
    return `Derived floor height of ${perFloor.toFixed(1)} ft looks wrong — bands use a 12.5 ft default.`;
  }
  return null;
}
