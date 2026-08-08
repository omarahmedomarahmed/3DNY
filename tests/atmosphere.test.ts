import { describe, expect, it } from 'vitest';
import {
  ATMOSPHERE,
  DEFAULT_TIME,
  HazeExtension,
  TIME_ORDER,
  hazeFor,
  skySpec,
} from '../src/components/map/atmosphere';

describe('atmosphere presets', () => {
  it('covers every hour the control can cycle to', () => {
    for (const key of TIME_ORDER) {
      expect(ATMOSPHERE[key]).toBeDefined();
      expect(ATMOSPHERE[key].key).toBe(key);
    }
    expect(TIME_ORDER).toHaveLength(Object.keys(ATMOSPHERE).length);
  });

  it('gives a dark room night and a light map daylight', () => {
    expect(ATMOSPHERE[DEFAULT_TIME.dark].key).toBe('night');
    expect(ATMOSPHERE[DEFAULT_TIME.light].key).toBe('morning');
  });

  it('keeps haze strength and light intensities in sane ranges', () => {
    for (const key of TIME_ORDER) {
      const p = ATMOSPHERE[key];
      expect(p.hazeStrength).toBeGreaterThan(0);
      // Full strength would dissolve distant geometry completely, including
      // any availability band drawn on it.
      expect(p.hazeStrength).toBeLessThan(1);
      expect(p.ambient).toBeGreaterThan(0);
      expect(p.sun).toBeGreaterThan(0);
      expect(p.haze).toHaveLength(3);
      for (const c of p.haze) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });

  it('moves the sun rather than only re-tinting: every hour is a distinct time', () => {
    const stamps = TIME_ORDER.map((k) => ATMOSPHERE[k].timestamp);
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it('night is darker and hazier than midday', () => {
    expect(ATMOSPHERE.night.sun).toBeLessThan(ATMOSPHERE.midday.sun);
    expect(ATMOSPHERE.night.hazeStrength).toBeGreaterThan(ATMOSPHERE.midday.hazeStrength);
  });
});

describe('skySpec', () => {
  it('produces a MapLibre sky whose fog matches its own horizon', () => {
    const spec = skySpec(ATMOSPHERE.golden);
    expect(spec['sky-color']).toBe(ATMOSPHERE.golden.sky);
    expect(spec['horizon-color']).toBe(ATMOSPHERE.golden.horizon);
    // Fog that does not match the horizon reads as a filter over the scene
    // rather than as air.
    expect(spec['fog-color']).toBe(ATMOSPHERE.golden.horizon);
  });

  it('holds the atmosphere back from washing over the tallest towers', () => {
    expect(skySpec(ATMOSPHERE.midday)['atmosphere-blend']).toBeLessThan(1);
  });
});

describe('the haze shader', () => {
  /** The shader source deck.gl would compile, for a given extension. */
  function sources(ext: HazeExtension) {
    // getShaders is called with the layer as `this` and the extension as the
    // argument — reading options off `this` compiles and silently does
    // nothing, which is its own documented trap here.
    const shaders = ext.getShaders.call({} as never, ext) as {
      inject: Record<string, string>;
    };
    return shaders.inject;
  }

  it('NEVER modifies colour during a picking pass', () => {
    // The single most important assertion in this file. deck.gl decodes object
    // ids from exact RGB read back out of the framebuffer, so tinting during
    // picking makes clicks resolve to the wrong object or to none — which has
    // broken building clicks on this map twice.
    const fs = sources(new HazeExtension())['fs:DECKGL_FILTER_COLOR'];
    expect(fs).toContain('picking.isActive');
    // The colour write must be inside the guard, not merely near it.
    const guardAt = fs.indexOf('picking.isActive');
    const writeAt = fs.indexOf('color.rgb');
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(writeAt).toBeGreaterThan(guardAt);
  });

  it('bakes its options into the source, so they are not silently dropped', () => {
    const fs = sources(new HazeExtension({ color: [10, 20, 30], strength: 0.5 }))[
      'fs:DECKGL_FILTER_COLOR'
    ];
    expect(fs).toContain((10 / 255).toFixed(4));
    expect(fs).toContain('0.500');
  });

  it('leaves the near field completely untouched', () => {
    // Haze that starts at the camera takes contrast off the building being
    // pointed at, which is the one thing this map cannot afford.
    const ext = new HazeExtension({ startM: 700, endM: 6200 });
    const fs = sources(ext)['fs:DECKGL_FILTER_COLOR'];
    expect(fs).toContain('smoothstep(700.0, 6200.0');
  });

  it('keeps the far bound above the near bound even if asked not to', () => {
    const fs = sources(new HazeExtension({ startM: 900, endM: 100 }))[
      'fs:DECKGL_FILTER_COLOR'
    ];
    // smoothstep with edge1 <= edge0 is undefined, and would band or invert.
    expect(fs).toContain('smoothstep(900.0, 901.0');
  });
});

describe('hazeFor', () => {
  it('reuses one extension per appearance, so shaders are not recompiled', () => {
    // A fresh instance per render means a fresh program and a recompile on
    // every frame the camera moves.
    expect(hazeFor(ATMOSPHERE.morning, 1)).toBe(hazeFor(ATMOSPHERE.morning, 1));
  });

  it('gives scenery and data-carrying buildings different instances', () => {
    expect(hazeFor(ATMOSPHERE.morning, 1)).not.toBe(hazeFor(ATMOSPHERE.morning, 0.42));
  });

  it('clamps a scale that would exceed full strength', () => {
    expect(hazeFor(ATMOSPHERE.night, 10).opts.strength).toBeLessThanOrEqual(1);
    expect(hazeFor(ATMOSPHERE.night, -1).opts.strength).toBeGreaterThanOrEqual(0);
  });
});
