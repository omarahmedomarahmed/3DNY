import { describe, expect, it } from 'vitest';
import { photorealInRange, PHOTOREAL_MIN_ZOOM } from '../src/components/map/photoreal';
import { tileCacheKey } from '../src/lib/tile-cache';

const MIDTOWN = { lng: -73.98, lat: 40.755 };

describe('photorealInRange', () => {
  it('draws over Manhattan when zoomed in', () => {
    expect(photorealInRange(MIDTOWN, PHOTOREAL_MIN_ZOOM)).toBe(true);
  });

  it('is suppressed at the framing zoom, where the tri-state was being billed', () => {
    expect(photorealInRange(MIDTOWN, 13)).toBe(false);
    expect(photorealInRange(MIDTOWN, PHOTOREAL_MIN_ZOOM - 0.1)).toBe(false);
  });

  it('is suppressed outside Manhattan even when zoomed in', () => {
    // Newark, and Stamford CT — both inside the old traversal, neither useful.
    expect(photorealInRange({ lng: -74.17, lat: 40.73 }, 17)).toBe(false);
    expect(photorealInRange({ lng: -73.54, lat: 41.05 }, 17)).toBe(false);
  });

  it('still covers the edges of the island', () => {
    expect(photorealInRange({ lng: -74.017, lat: 40.703 }, 16)).toBe(true); // Battery
    expect(photorealInRange({ lng: -73.934, lat: 40.874 }, 16)).toBe(true); // Inwood
  });
});

describe('tileCacheKey', () => {
  it('ignores the per-session token, so a reload hits the cache', () => {
    const a = 'https://tile.googleapis.com/v1/3dtiles/datasets/x/files/y.glb?session=AAA';
    const b = 'https://tile.googleapis.com/v1/3dtiles/datasets/x/files/y.glb?session=BBB';
    expect(tileCacheKey(a)).toBe(tileCacheKey(b));
  });

  it('never writes the API key to disk', () => {
    const url = 'https://tile.googleapis.com/v1/3dtiles/x.glb?session=A&key=SECRET';
    expect(tileCacheKey(url)).not.toContain('SECRET');
  });

  it('keeps different tiles apart', () => {
    const a = 'https://tile.googleapis.com/v1/3dtiles/datasets/x/files/one.glb?session=A';
    const b = 'https://tile.googleapis.com/v1/3dtiles/datasets/x/files/two.glb?session=A';
    expect(tileCacheKey(a)).not.toBe(tileCacheKey(b));
  });
});
