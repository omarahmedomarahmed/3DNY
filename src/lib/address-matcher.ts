import { normalizeAddress } from '@/lib/db';
import { lookupAddressPoint } from '@/lib/nyc-addresses';
import type { MatchConfidence } from '@/types';

/**
 * Resolves a free-text address from the weekly sheet to a physical NYC
 * building (BIN + BBL + coordinates).
 *
 * Two independent sources, in order:
 *
 *   1. NYC Planning's Geosearch — authoritative, and returns BIN, BBL and
 *      coordinates in a single call.
 *   2. NYC AddressPoint on Socrata — the same free, keyless infrastructure the
 *      map's footprints, streets and parks already come from.
 *
 * The second one exists because the first is a single hosted service. When it
 * started returning 503, every row of every sheet came back "unmatched" and
 * the importer stopped working entirely — including for the bundled samples,
 * so a deleted inventory could not be restored. A geocoder outage should cost
 * a slower import, not the product.
 *
 * A wrong building highlighted in front of a client is worse than no map, so
 * neither source guesses silently: anything short of an exact hit comes back
 * as `fuzzy` or `unmatched` and lands in the review queue with an explanation
 * that says which source spoke and what it said.
 */

const GEOSEARCH = 'https://geosearch.planninglabs.nyc/v2/search';

/**
 * Once Geosearch has failed, stop calling it for the rest of the process.
 *
 * An import geocodes every unique address, and each address tries several
 * candidate spellings. Against a service that is down, that is dozens of
 * requests all waiting for the same timeout — an import that should take
 * seconds instead takes minutes to arrive at the same answer.
 */
let geosearchDown = false;

/** Test seam: lets a run start from a known state. */
export function resetGeosearchHealth(): void {
  geosearchDown = false;
}

export interface GeocodeResult {
  confidence: MatchConfidence;
  bin: string | null;
  bbl: string | null;
  lon: number | null;
  lat: number | null;
  resolvedAddress: string | null;
  explanation: string;
}

interface GeosearchFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    label?: string;
    name?: string;
    confidence?: number;
    borough?: string;
    locality?: string;
    region?: string;
    addendum?: { pad?: { bin?: string; bbl?: string } };
  };
}

/**
 * Geosearch answers a Manhattan query with Staten Island and Brooklyn results.
 * Manhattan addresses carry locality/borough "New York" or "Manhattan".
 */
function isManhattan(f: GeosearchFeature): boolean {
  const where = `${f.properties.borough ?? ''} ${f.properties.locality ?? ''}`.toLowerCase();
  if (where.includes('manhattan') || where.includes('new york')) return true;
  // Fall back to the label, which ends `, New York, NY, USA` for Manhattan.
  return /,\s*(new york|manhattan),\s*ny/i.test(f.properties.label ?? '');
}

/**
 * `22-30 Little W 12th Street` → ['22-30 …', '22 …', '30 …'].
 * The city indexes some ranges under the low number and some under the high,
 * so try the literal string first and then each end.
 */
export function addressCandidates(address: string): string[] {
  const trimmed = address.trim();
  const out = [trimmed];

  const range = trimmed.match(/^(\d+)\s*-\s*(\d+)\s+(.*)$/);
  if (range) {
    const [, low, high, rest] = range;
    out.push(`${low} ${rest}`, `${high} ${rest}`);
  }

  // `24-32 Union Sq E` → also try the expanded street type.
  const expanded = trimmed
    .replace(/\bSq\b/gi, 'Square')
    .replace(/\bSt\b/gi, 'Street')
    .replace(/\bAve\b/gi, 'Avenue');
  if (expanded !== trimmed) out.push(expanded);

  return [...new Set(out)];
}

function unmatched(reason: string): GeocodeResult {
  return {
    confidence: 'unmatched',
    bin: null,
    bbl: null,
    lon: null,
    lat: null,
    resolvedAddress: null,
    explanation: reason,
  };
}

/**
 * How long Geosearch gets before we stop waiting and ask the other source.
 *
 * Being slow and being down are the same thing to a broker with a client
 * waiting. Geosearch has been observed answering correctly but taking 7-9
 * seconds per request, which across the unique addresses in one weekly sheet
 * turns a few seconds of import into a few minutes. AddressPoint answers in
 * well under a second, so anything past this is not worth waiting for.
 */
const GEOSEARCH_TIMEOUT_MS = 4000;

async function query(text: string, signal?: AbortSignal): Promise<GeosearchFeature[]> {
  const url = `${GEOSEARCH}?text=${encodeURIComponent(`${text}, Manhattan, NY`)}&size=5`;

  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(), GEOSEARCH_TIMEOUT_MS);
  // Honour the caller's cancellation as well as our own deadline.
  const onAbort = () => timer.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const res = await fetch(url, {
      signal: timer.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Geosearch returned ${res.status}`);
    const json = (await res.json()) as { features?: GeosearchFeature[] };
    return json.features ?? [];
  } catch (err) {
    if ((err as Error).name === 'AbortError' && !signal?.aborted) {
      throw new Error(`Geosearch did not answer within ${GEOSEARCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** A BIN of all zeroes means "no building here" — treat it as no match. */
function usableBin(bin: string | undefined): string | null {
  if (!bin) return null;
  if (/^0+$/.test(bin)) return null;
  return bin;
}

export async function geocodeAddress(
  address: string,
  opts: { signal?: AbortSignal } = {},
): Promise<GeocodeResult> {
  if (!/\d/.test(address)) {
    return unmatched(
      'No street number in the address — pick the building on the map once and ' +
        'it will be remembered for every future import.',
    );
  }

  const candidates = addressCandidates(address);
  let nearest: { feature: GeosearchFeature; candidate: string } | null = null;
  let geosearchError: string | null = geosearchDown ? 'previously unreachable' : null;

  for (let i = 0; i < candidates.length && !geosearchDown; i++) {
    const candidate = candidates[i];
    let features: GeosearchFeature[];
    try {
      features = await query(candidate, opts.signal);
    } catch (err) {
      // Do not give up on the address — try the other source below. But do
      // stop asking this one, for this address and every later one.
      geosearchDown = true;
      geosearchError = (err as Error).message;
      break;
    }

    // Cross-borough results are never right for a Manhattan leasing sheet.
    features = features.filter(isManhattan);
    if (features.length === 0) continue;

    const wanted = normalizeAddress(candidate);

    // Only a character-for-character match after normalisation is "exact".
    // `200 Park Avenue` must not silently become `200 Park Avenue South`.
    const exact = features.find(
      (f) => normalizeAddress((f.properties.label ?? '').split(',')[0] ?? '') === wanted,
    );

    if (exact) {
      const bin = usableBin(exact.properties.addendum?.pad?.bin);
      const [lon, lat] = exact.geometry.coordinates;
      const label = exact.properties.label ?? candidate;
      if (bin) {
        return {
          confidence: i === 0 ? 'exact' : 'fuzzy',
          bin,
          bbl: exact.properties.addendum?.pad?.bbl ?? null,
          lon,
          lat,
          resolvedAddress: label,
          explanation:
            i === 0
              ? `Matched exactly to ${label} (BIN ${bin}).`
              : `No result for "${address}". The range end "${candidate}" matched ` +
                `${label} (BIN ${bin}). Confirm the building.`,
        };
      }
    }

    if (!nearest) nearest = { feature: features[0], candidate };
  }

  // --- Second source. Reached either because Geosearch is down, or because it
  // answered without an exact building for this address.
  const point = await lookupAddressPoint(address, { signal: opts.signal });
  if (point) {
    return {
      confidence: 'exact',
      bin: point.bin,
      bbl: point.bbl,
      lon: point.lon,
      lat: point.lat,
      resolvedAddress: point.label,
      explanation: geosearchError
        ? `NYC Geosearch is unavailable (${geosearchError}), so this was matched ` +
          `against NYC AddressPoint instead: ${point.label} (BIN ${point.bin}).`
        : `Matched to ${point.label} (BIN ${point.bin}) via NYC AddressPoint.`,
    };
  }

  if (nearest) {
    const { feature, candidate } = nearest;
    const bin = usableBin(feature.properties.addendum?.pad?.bin);
    const [lon, lat] = feature.geometry.coordinates;
    const label = feature.properties.label ?? candidate;
    return {
      confidence: 'fuzzy',
      bin,
      bbl: feature.properties.addendum?.pad?.bbl ?? null,
      lon,
      lat,
      resolvedAddress: label,
      explanation:
        `NYC Geosearch has no exact record of "${address}". Its closest Manhattan ` +
        `result is ${label}${bin ? ` (BIN ${bin})` : ''}, which is a different address. ` +
        'Confirm the building on the map — your choice is saved permanently.',
    };
  }

  if (geosearchError) {
    return unmatched(
      `NYC Geosearch is unavailable (${geosearchError}) and NYC AddressPoint has no ` +
        `record of "${address}". Pick the building on the map — your choice is saved ` +
        'permanently, so this address will never ask again.',
    );
  }

  return unmatched(
    `Neither NYC Geosearch nor AddressPoint has a Manhattan record of "${address}". ` +
      'Pick the building on the map.',
  );
}

/**
 * A few addresses at a time, rather than one after another.
 *
 * This was strictly sequential with a politeness delay between each address,
 * which is fine against a service answering in 100ms and is not fine against
 * one answering in eight seconds — a weekly sheet's two dozen unique addresses
 * took over two minutes, which reads as a hung import rather than a slow one.
 *
 * Four at a time is polite to both sources — well under any published rate
 * limit, and roughly what a browser would open to one host anyway — while
 * making the whole run take about as long as its slowest few addresses.
 */
const GEOCODE_CONCURRENCY = 4;

export async function geocodeAll(
  addresses: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, GeocodeResult>> {
  const unique = [...new Set(addresses)];
  const results = new Map<string, GeocodeResult>();
  let done = 0;
  let next = 0;

  async function worker() {
    while (next < unique.length) {
      const i = next++;
      const address = unique[i];
      try {
        results.set(address, await geocodeAddress(address));
      } catch (err) {
        // One address failing must never abandon the rest of the sheet.
        results.set(
          address,
          unmatched(
            `Address lookup failed (${(err as Error).message}). ` +
              'Pick the building on the map.',
          ),
        );
      }
      onProgress?.(++done, unique.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(GEOCODE_CONCURRENCY, unique.length) }, worker),
  );
  return results;
}
