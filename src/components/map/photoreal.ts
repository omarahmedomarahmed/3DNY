import type { Layer } from '@deck.gl/core';

/**
 * Photorealistic mode: Google's 3D Tiles, the only source of actual
 * photogrammetry — real facades, real setbacks, real rooftop plant — covering
 * all of Manhattan.
 *
 * It is deliberately opt-in and off by default, for two reasons.
 *
 * Cost: the tiles are billed per request against a Google Cloud key. Grey
 * massing from NYC Open Data is free and always available, so the default view
 * costs nothing and works with no account anywhere.
 *
 * Legibility: a photoreal city is beautiful and busy. The point of this tool is
 * that a Goldenrod band on the 14th floor is the loudest thing on screen, and
 * against photography it is not. So the mode exists for the moment a client
 * asks "what does it actually look like" — and the availability layers switch
 * to depth-independent drawing while it is on, so they stay visible through the
 * mesh rather than being swallowed by it.
 *
 * Attribution is not optional. Google requires the per-tile copyright strings
 * of whatever is currently on screen to be displayed, which is why the caller
 * is handed them on every traversal.
 */

const GOOGLE_TILESET = 'https://tile.googleapis.com/v1/3dtiles/root.json';

/** How long to wait for Google before calling the mode unavailable. */
const PROBE_TIMEOUT_MS = 8000;

/**
 * The 3D-tiles reader and its glTF dependencies are around a megabyte, and most
 * sessions never turn this mode on. Loading them on first use keeps the map's
 * opening download exactly what it was before this feature existed.
 */
export interface PhotorealModule {
  Tile3DLayer: any;
  Tiles3DLoader: any;
}

let modulePromise: Promise<PhotorealModule> | null = null;

export function loadPhotorealModule(): Promise<PhotorealModule> {
  if (!modulePromise) {
    modulePromise = Promise.all([
      import('@deck.gl/geo-layers'),
      import('@loaders.gl/3d-tiles'),
    ])
      .then(([geo, tiles]) => ({
        Tile3DLayer: (geo as any).Tile3DLayer,
        Tiles3DLoader: (tiles as any).Tiles3DLoader,
      }))
      // A failed import must not be cached, or one flaky network request
      // disables the mode for the rest of the session.
      .catch((err) => {
        modulePromise = null;
        throw err;
      });
  }
  return modulePromise;
}

/**
 * Asks Google for the root tileset before the mode is committed to.
 *
 * Tile3DLayer reports a failed traversal only to the console, so a wrong key
 * would otherwise leave a blank map with the toggle stuck on and no
 * explanation. Probing first turns every failure into a sentence someone can
 * act on, in the vocabulary of the Google Cloud screens they just used.
 */
export async function probePhotoreal(): Promise<string | null> {
  const key = photorealKey();
  if (!key) return 'no Google key is configured.';

  // A blocked network can leave the request pending indefinitely rather than
  // rejecting — a corporate proxy that drops packets silently does exactly
  // this. Without a deadline the toggle would sit on, showing nothing, forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(GOOGLE_TILESET, {
      headers: { 'X-GOOG-API-KEY': key },
      signal: controller.signal,
    });
    if (res.ok) return null;

    if (res.status === 400 || res.status === 403) {
      return (
        'Google rejected the key. Check that the Map Tiles API is enabled and ' +
        "that this site's address is allowed under the key's website restrictions."
      );
    }
    if (res.status === 401) return 'the Google key is not valid.';
    if (res.status === 429) return 'the Google usage limit for this key has been reached.';
    return `Google returned ${res.status}.`;
  } catch {
    return 'Google could not be reached from this network.';
  } finally {
    clearTimeout(timer);
  }
}

/** The key is public by nature — it ships to the browser. Restrict it by referrer. */
export function photorealKey(): string | null {
  const key = process.env.NEXT_PUBLIC_GOOGLE_3D_TILES_KEY;
  return key && key.trim() ? key.trim() : null;
}

export function photorealAvailable(): boolean {
  return photorealKey() !== null;
}

export interface PhotorealOptions {
  /** Receives the copyright lines for the tiles currently drawn. */
  onAttribution: (credits: string[]) => void;
  /** Called once if the tileset cannot be loaded, so the UI can back out. */
  onError: (message: string) => void;
}

/**
 * The layer, or null when no key is configured. Callers treat null as "stay on
 * the free grey city" — never as an error.
 */
export function buildPhotorealLayer(
  mod: PhotorealModule | null,
  opts: PhotorealOptions,
): Layer | null {
  const key = photorealKey();
  if (!key || !mod) return null;

  const { Tile3DLayer, Tiles3DLoader } = mod;

  return new Tile3DLayer({
    id: 'google-photoreal',
    data: GOOGLE_TILESET,
    loader: Tiles3DLoader,
    // The key travels as a header rather than a query parameter so it is not
    // baked into every child tile URL the traversal generates.
    loadOptions: {
      fetch: { headers: { 'X-GOOG-API-KEY': key } },
    },
    // Scenery, like the grey massing it replaces: a click must never land on
    // a photogrammetry mesh instead of on a building with data.
    pickable: false,
    onTilesetLoad: (tileset: any) => {
      tileset.options.onTraversalComplete = (selected: any[]) => {
        const credits = new Set<string>();
        for (const tile of selected) {
          const copyright = tile?.content?.gltf?.asset?.copyright;
          if (typeof copyright === 'string') {
            for (const part of copyright.split(';')) {
              const trimmed = part.trim();
              if (trimmed) credits.add(trimmed);
            }
          }
        }
        opts.onAttribution([...credits]);
        return selected;
      };
    },
    onTileError: undefined,
    onError: (err: Error) => {
      opts.onError(
        err?.message ??
          'Google 3D Tiles could not be loaded. Check the key and that the ' +
            'Map Tiles API is enabled.',
      );
    },
  } as any) as unknown as Layer;
}
