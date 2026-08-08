import { describe, expect, it } from 'vitest';
import {
  FACADE_CONTEXT_DARK,
  FACADE_CONTEXT_LIGHT,
  FACADE_DARK,
  FACADE_LIGHT,
  FacadeExtension,
} from '../src/components/map/facade';

/**
 * The facade shader's emitted source.
 *
 * Two failure modes here are both silent, which is why they are worth a test.
 *
 * A shader that fails to COMPILE does not throw anywhere useful — deck.gl logs
 * a link error and the buildings simply do not render. That is how `#if` with
 * a float comparison got shipped: GLSL's preprocessor only evaluates integer
 * constant expressions, so `#if 5.0 > 0.5` killed the whole fragment shader.
 *
 * And a shader that touches the fragment colour during the PICKING pass looks
 * completely correct while making every building unclickable, which has
 * happened on this map twice.
 */

function sources(ext: FacadeExtension) {
  // getShaders is called with the layer as `this` and the extension as the
  // argument. Reading options off `this` compiles and silently does nothing.
  const shaders = ext.getShaders.call({} as never, ext) as {
    inject: Record<string, string>;
  };
  return shaders.inject;
}

const ALL = [FACADE_DARK, FACADE_LIGHT, FACADE_CONTEXT_DARK, FACADE_CONTEXT_LIGHT];

describe('the facade shader never breaks picking', () => {
  for (const [i, ext] of ALL.entries()) {
    it(`guards the fragment colour write (variant ${i})`, () => {
      const fs = sources(ext)['fs:DECKGL_FILTER_COLOR'];
      const guardAt = fs.indexOf('picking.isActive');
      expect(guardAt).toBeGreaterThanOrEqual(0);
      // Every write to the colour must come after the guard opens.
      for (const write of ['color.rgb *=', 'color.rgb = mix']) {
        const at = fs.indexOf(write);
        expect(at, `${write} must be inside the guard`).toBeGreaterThan(guardAt);
      }
    });
  }
});

describe('the emitted GLSL is compilable', () => {
  for (const [i, ext] of ALL.entries()) {
    const src = sources(ext);
    const all = Object.values(src).join('\n');

    it(`uses no preprocessor conditional on a float (variant ${i})`, () => {
      // `#if 5.0 > 0.5` is not valid GLSL and takes the whole shader with it.
      const badIf = /#if[^\n]*\d+\.\d+/.exec(all);
      expect(badIf?.[0] ?? null).toBeNull();
    });

    it(`leaves no unsubstituted template placeholder (variant ${i})`, () => {
      expect(all).not.toContain('${');
    });

    it(`balances its braces (variant ${i})`, () => {
      const open = (all.match(/\{/g) ?? []).length;
      const close = (all.match(/\}/g) ?? []).length;
      expect(open).toBe(close);
    });

    it(`declares every varying it reads (variant ${i})`, () => {
      const declared = [...(src['vs:#decl'].match(/out float (\w+)/g) ?? [])].map((d) =>
        d.replace('out float ', ''),
      );
      const readIn = [...(src['fs:#decl'].match(/in float (\w+)/g) ?? [])].map((d) =>
        d.replace('in float ', ''),
      );
      expect(readIn.sort()).toEqual(declared.sort());
      for (const name of readIn) {
        expect(src['fs:DECKGL_FILTER_COLOR']).toContain(name);
      }
    });
  }
});

describe('piers', () => {
  it('emits the pier block when asked for', () => {
    const fs = sources(new FacadeExtension({ pierEvery: 5 }))['fs:DECKGL_FILTER_COLOR'];
    expect(fs).toContain('pierCoord');
    expect(fs).toContain('deckgl_mullion / 5.0');
  });

  it('omits it entirely when turned off, rather than branching in GLSL', () => {
    const fs = sources(new FacadeExtension({ pierEvery: 0 }))['fs:DECKGL_FILTER_COLOR'];
    expect(fs).not.toContain('pierCoord');
    // The variable still exists so the line that reads it stays valid.
    expect(fs).toContain('float pierLine = 0.0;');
  });
});

describe('vertical shading', () => {
  it('reads the wall height from the side-vertex position', () => {
    const vs = sources(FACADE_DARK)['vs:DECKGL_FILTER_COLOR'];
    expect(vs).toContain('deckgl_facadeUp = positions.y;');
    // And only on side faces — a roof has no up-the-wall coordinate.
    expect(vs).toContain('#ifdef IS_SIDE_VERTEX');
  });

  it('gives the dark map a stronger gradient than the light one', () => {
    // A dark tower with no gradient is a silhouette with nothing in it.
    expect(FACADE_DARK.opts.gradient).toBeGreaterThan(FACADE_LIGHT.opts.gradient);
  });

  it('keeps the surrounding city quieter than the buildings with data', () => {
    expect(FACADE_CONTEXT_DARK.opts.strength).toBeLessThan(FACADE_DARK.opts.strength);
    expect(FACADE_CONTEXT_DARK.opts.pierEvery).toBe(0);
  });
});
