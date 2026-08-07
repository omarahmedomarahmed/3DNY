/**
 * A persistent, on-device cache for Google's 3D tiles.
 *
 * Without it, every page load re-downloads and re-bills every tile: one open of
 * a wide view cost 1,813 Map Tiles API requests. Tiles are photogrammetry of
 * buildings that do not move, so re-fetching them on each reload buys nothing.
 *
 * The cache lives in the browser's Cache Storage, which survives reloads and
 * closing the tab, so the second visit to a block is instant and free.
 *
 * The important subtlety is the cache key. Google's child-tile URLs carry a
 * `session` parameter that changes every time the tileset root is opened, so
 * keying on the raw URL would miss on every reload — the exact case this is
 * built for. Both `session` and `key` are stripped: neither changes which
 * building the tile contains, and stripping `key` also keeps the API key out of
 * anything written to disk.
 *
 * Every cache operation is wrapped: a storage failure, a full disk or a browser
 * with Cache Storage disabled must degrade to plain network fetches, never to a
 * broken map.
 */

const CACHE_NAME = 'cresa-3d-tiles-v1';

/**
 * How long a cached tile is trusted. Kept deliberately short of Google's
 * permitted caching window — check the current Google Maps Platform terms
 * before raising it.
 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Roughly a few hundred MB of tiles. Trimmed oldest-first past this. */
const MAX_ENTRIES = 3000;

/** Trimming walks every key, so it runs occasionally rather than per write. */
const TRIM_EVERY = 250;

const STAMP_HEADER = 'x-cresa-cached-at';

let writesSinceTrim = 0;
let trimming = false;

function cacheAvailable(): boolean {
  return typeof caches !== 'undefined' && typeof Request !== 'undefined';
}

/** The URL with the per-session and per-key parameters removed. */
export function tileCacheKey(url: string): string {
  try {
    const parsed = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
    parsed.searchParams.delete('session');
    parsed.searchParams.delete('key');
    return parsed.toString();
  } catch {
    return url;
  }
}

function isFresh(res: Response): boolean {
  const stamp = Number(res.headers.get(STAMP_HEADER));
  return Number.isFinite(stamp) && stamp > 0 && Date.now() - stamp < TTL_MS;
}

/**
 * Drops the oldest entries once the cache grows past its cap. Runs at most one
 * at a time and never blocks the fetch that triggered it.
 */
async function trim(cache: Cache): Promise<void> {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    if (keys.length <= MAX_ENTRIES) return;

    const stamped = await Promise.all(
      keys.map(async (req) => {
        const res = await cache.match(req);
        return { req, at: Number(res?.headers.get(STAMP_HEADER)) || 0 };
      }),
    );
    stamped.sort((a, b) => a.at - b.at);

    // Take it a quarter below the cap, so trimming is occasional rather than
    // constant once the cache is full.
    const target = Math.floor(MAX_ENTRIES * 0.75);
    for (const entry of stamped.slice(0, keys.length - target)) {
      await cache.delete(entry.req);
    }
  } catch {
    // A cache that cannot be trimmed is still a working cache.
  } finally {
    trimming = false;
  }
}

async function readCache(url: string): Promise<Response | null> {
  if (!cacheAvailable()) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(tileCacheKey(url));
    if (!hit) return null;
    if (isFresh(hit)) {
      // A Response built from the cache has an empty `url`, and loaders.gl
      // resolves relative references against it. Restoring the real address
      // keeps a cache hit indistinguishable from a network response.
      try {
        Object.defineProperty(hit, 'url', { value: url, configurable: true });
      } catch {
        // Non-configurable in this browser; the tile still loads.
      }
      return hit;
    }
    await cache.delete(tileCacheKey(url));
    return null;
  } catch {
    return null;
  }
}

async function writeCache(url: string, res: Response): Promise<void> {
  if (!cacheAvailable()) return;
  try {
    const body = await res.arrayBuffer();
    const headers = new Headers();
    // Only the headers a tile actually needs are carried over; copying the
    // whole set would persist Google's auth and rate-limit headers to disk.
    const type = res.headers.get('content-type');
    if (type) headers.set('content-type', type);
    headers.set(STAMP_HEADER, String(Date.now()));

    const cache = await caches.open(CACHE_NAME);
    await cache.put(tileCacheKey(url), new Response(body, { status: 200, headers }));

    writesSinceTrim += 1;
    if (writesSinceTrim >= TRIM_EVERY) {
      writesSinceTrim = 0;
      void trim(cache);
    }
  } catch {
    // Out of quota, private mode, or a response that cannot be cloned. The
    // caller already has its response; nothing here is worth surfacing.
  }
}

/**
 * A `fetch` for loaders.gl that answers from disk when it can.
 *
 * The tileset root is never cached: it is what mints the session the child
 * tiles are fetched with, and a stale one means every child request fails.
 */
export function createCachingFetch(apiKey: string, rootUrl: string) {
  return async function cachingFetch(url: string, options?: RequestInit): Promise<Response> {
    const headers = new Headers(options?.headers ?? {});
    headers.set('X-GOOG-API-KEY', apiKey);
    const request: RequestInit = { ...options, headers };

    // Anything unexpected in the caching path must end in an ordinary network
    // fetch. A cache is an optimisation; it is never allowed to be the reason
    // the map is empty.
    try {
      if (tileCacheKey(url) === tileCacheKey(rootUrl)) {
        return await fetch(url, request);
      }

      const hit = await readCache(url);
      if (hit) return hit;

      const res = await fetch(url, request);
      if (res.ok) {
        // Clone synchronously, before this response is handed back. Cloning
        // later — from inside the async write — races the caller's read of the
        // body and throws "already used", which silently disabled caching.
        let copy: Response | null = null;
        try {
          copy = res.clone();
        } catch {
          copy = null;
        }
        if (copy) void writeCache(url, copy);
      }
      return res;
    } catch {
      return fetch(url, request);
    }
  };
}

/** Removes every cached tile. Exposed so a stuck cache can be cleared by hand. */
export async function clearTileCache(): Promise<void> {
  if (!cacheAvailable()) return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // Nothing to do — the cache is best-effort in both directions.
  }
}
