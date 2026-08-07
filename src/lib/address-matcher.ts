import { normalizeAddress } from '@/lib/db';
import type { MatchConfidence } from '@/types';

/**
 * Resolves a free-text address from the weekly sheet to a physical NYC
 * building (BIN + BBL + coordinates) using the city's own Geosearch service.
 *
 * Free, keyless, and authoritative — it is the same index that powers NYC
 * Planning's address tools.
 *
 * A wrong building highlighted in front of a client is worse than no map, so
 * this never guesses silently: anything short of an exact hit comes back as
 * `fuzzy` or `unmatched` and lands in the review queue with an explanation.
 */

const GEOSEARCH = 'https://geosearch.planninglabs.nyc/v2/search';

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

async function query(text: string, signal?: AbortSignal): Promise<GeosearchFeature[]> {
  const url = `${GEOSEARCH}?text=${encodeURIComponent(`${text}, Manhattan, NY`)}&size=5`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geosearch returned ${res.status}`);
  const json = (await res.json()) as { features?: GeosearchFeature[] };
  return json.features ?? [];
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

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    let features: GeosearchFeature[];
    try {
      features = await query(candidate, opts.signal);
    } catch (err) {
      return unmatched(
        `Could not reach NYC Geosearch (${(err as Error).message}). Retry the import.`,
      );
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

  return unmatched(
    `NYC Geosearch has no Manhattan record of "${address}". Pick the building on the map.`,
  );
}

/** Small politeness delay so a 30-row import does not hammer the service. */
export async function geocodeAll(
  addresses: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, GeocodeResult>> {
  const unique = [...new Set(addresses)];
  const results = new Map<string, GeocodeResult>();

  for (let i = 0; i < unique.length; i++) {
    results.set(unique[i], await geocodeAddress(unique[i]));
    onProgress?.(i + 1, unique.length);
    if (i < unique.length - 1) await new Promise((r) => setTimeout(r, 120));
  }
  return results;
}
