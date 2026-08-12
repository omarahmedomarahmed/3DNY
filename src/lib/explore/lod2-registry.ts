import type { Massing } from '@/lib/citygml';
import { heightProfile, sectionAt, type HeightProfile, type Lod2Asset } from './lod2';
import { makeFrame, toLngLat } from './frame';

/**
 * The surveyed massing, once, for everything that needs it.
 *
 * Three separate parts of the app ask the same question — the renderer wants
 * geometry, the band builder wants the tower's width at an elevation, and the
 * verification harness wants to know which buildings were matched at all —
 * and none of them are in a position to hand the asset to the others. The
 * renderer is a MapLibre custom layer, the band builder runs inside deck.gl's
 * layer construction, and they meet nowhere except here.
 *
 * A module-scope registry rather than React state, for the same reason: the
 * asset is immutable, it is fetched once per page, and threading it through
 * two component trees that do not overlap would be ceremony around a constant.
 *
 * It is empty until `loadLod2()` resolves, and every consumer treats empty as
 * "fall back to the extruded footprint" — which is exactly the behaviour the
 * two buildings the 2014 survey predates need permanently. There is no
 * separate loading state to handle, because a building with no surveyed
 * massing and a building whose massing has not arrived yet want the same
 * thing.
 */

export interface Lod2Entry {
  massing: Massing;
  profile: HeightProfile | null;
  /**
   * Cross-sections, cached by height to the nearest metre.
   *
   * Band geometry is rebuilt on every filter change, selection and colour
   * override, and a slice walks every wall polygon in the building — 469 of
   * them on the Empire State Building. Recomputing a dozen of those per
   * keystroke in the filter box is the kind of cost that only shows up on the
   * machine that matters.
   */
  sections: Map<number, [number, number][]>;
}

const entries = new Map<string, Lod2Entry>();
let loaded = false;
let loading: Promise<void> | null = null;
let missing: string[] = [];

/** The asset's own path. Gitignored and regenerated in about 20 seconds. */
export const LOD2_URL = '/lod2/massing.json';

export function lod2For(bin: string | null | undefined): Lod2Entry | null {
  if (!bin) return null;
  return entries.get(bin) ?? null;
}

export function lod2Stats(): { matched: number; missing: number; loaded: boolean } {
  return { matched: entries.size, missing: missing.length, loaded };
}

/**
 * Fetches the asset, at most once.
 *
 * A failure is swallowed on purpose. The asset is gitignored and regenerated
 * by a script, so a checkout that has not run it yet is a completely normal
 * state — and the consequence is that every building falls back to its
 * extruded footprint, which is the map as it was before this sprint. An
 * Explore mode that refuses to open because a silhouette asset is missing
 * would be a far worse failure than one that opens with plainer towers.
 */
/**
 * The surveyed massing, from disk if it has been here before.
 *
 * `cache: 'force-cache'` already asks the HTTP cache, and the HTTP cache is
 * allowed to evict whenever it likes — so the 150 KB asset that decides
 * whether the whole city has real setbacks is re-downloaded on a schedule
 * nobody controls. Cache Storage is not evicted casually, survives reloads and
 * closing the tab, and this project already uses it for exactly this reason
 * (`lib/tile-cache.ts`, for Google's 3-D tiles).
 *
 * It is a single static file that changes only when the asset is regenerated,
 * so a stale copy is a real risk — hence the `ETag` check against the network
 * on every load. The saving is not the request; it is the 150 KB of transfer
 * and the parse.
 *
 * Every step is wrapped: a browser with Cache Storage disabled, a full disk or
 * a private window must degrade to a plain fetch, never to a city with no
 * setbacks in it.
 */
const SURVEYED_CACHE = 'cresa-lod2-v1';

async function fetchSurveyed(url: string): Promise<Lod2Asset> {
  let store: Cache | null = null;
  try {
    store = typeof caches !== 'undefined' ? await caches.open(SURVEYED_CACHE) : null;
  } catch {
    store = null;
  }

  const cached = store ? await store.match(url).catch(() => undefined) : undefined;

  // A conditional request: the body only comes back if the asset changed.
  const headers: Record<string, string> = {};
  const etag = cached?.headers.get('etag');
  if (etag) headers['If-None-Match'] = etag;

  let res: Response;
  try {
    res = await fetch(url, { headers, cache: 'no-cache' });
  } catch (err) {
    if (cached) return (await cached.json()) as Lod2Asset;
    throw err;
  }

  if (res.status === 304 && cached) {
    return (await cached.json()) as Lod2Asset;
  }
  if (!res.ok) {
    if (cached) return (await cached.json()) as Lod2Asset;
    throw new Error(`${res.status}`);
  }

  if (store) {
    // Cloned before reading, because a body can only be consumed once.
    try {
      await store.put(url, res.clone());
    } catch {
      // A full disk is not a reason to fail.
    }
  }
  return (await res.json()) as Lod2Asset;
}

export function loadLod2(url = LOD2_URL): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loading) return loading;

  loading = fetchSurveyed(url)
    .then((asset) => {
      ingest(asset);
    })
    .catch(() => {
      // Nothing surveyed. Everything extrudes, which is the previous
      // behaviour and a perfectly good map.
      loaded = true;
    })
    .finally(() => {
      loading = null;
    });

  return loading;
}

/** Exposed so a test can load an asset without a network. */
export function ingest(asset: Lod2Asset): void {
  entries.clear();
  for (const [bin, massing] of Object.entries(asset.buildings ?? {})) {
    entries.set(bin, { massing, profile: heightProfile(massing), sections: new Map() });
  }
  missing = (asset.missing ?? []).map((m) => m.bin);
  loaded = true;
}

/** Exposed for tests, which must not inherit another test's asset. */
export function resetLod2(): void {
  entries.clear();
  missing = [];
  loaded = false;
  loading = null;
}

/**
 * The building's own outline at an elevation, in lon/lat.
 *
 * Null when there is no surveyed massing, which is the signal to fall back to
 * the footprint — the two buildings in fifteen the 2014 capture predates, and
 * every building added since.
 */
export function surveyedSectionAt(
  bin: string | null | undefined,
  zM: number,
): [number, number][] | null {
  const entry = lod2For(bin);
  if (!entry) return null;

  const key = Math.round(zM);
  const cached = entry.sections.get(key);
  if (cached) return cached.length >= 3 ? cached : null;

  const local = sectionAt(entry.massing, key);
  const frame = makeFrame(entry.massing.anchor[0], entry.massing.anchor[1]);
  const ring = local.map(([x, y]) => toLngLat(frame, x, y));
  entry.sections.set(key, ring);
  // A slice above the mast, or below the lowest wall, has nothing in it.
  return ring.length >= 3 ? ring : null;
}
