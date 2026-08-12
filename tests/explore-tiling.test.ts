import { describe, expect, it } from 'vitest';
import {
  buildTree,
  flatten,
  geometricErrorFor,
  mergeNode,
  toTilesetJson,
  type TiledBuilding,
} from '@/lib/explore/tiling';
import { writeGlb } from '@/lib/explore/glb';

/**
 * The 3-D Tiles build, which nothing else can check.
 *
 * A tileset is written by a script that streams a 916 MB archive and produces
 * a directory of binary files — none of which anybody is going to open in a
 * hex editor when the city fails to appear. Every part of it that can be wrong
 * without being obviously wrong is asserted here: the tree's partitioning, the
 * geometric errors that decide when anything loads at all, the bounding
 * volumes, and the byte-level structure of the glTF.
 */

function cube(cx: number, cy: number, height: number): TiledBuilding {
  // A unit box at (cx, cy), which is all these tests need to be about.
  const position = new Float32Array([
    cx - 5, cy - 5, 0,
    cx + 5, cy - 5, 0,
    cx + 5, cy + 5, 0,
    cx - 5, cy + 5, height,
  ]);
  const normal = new Float32Array(position.length).fill(0);
  const index = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return { position, normal, index, cx, cy, height };
}

const SQUARE: [number, number, number, number] = [-1000, -1000, 1000, 1000];

describe('geometricErrorFor', () => {
  it('scales with the tile', () => {
    expect(geometricErrorFor(1600)).toBe(100);
    expect(geometricErrorFor(400)).toBe(25);
  });

  it('is never zero for a real tile', () => {
    // Zero on a node with children means "stopping here is exact", which would
    // stop the renderer ever refining past it.
    expect(geometricErrorFor(10)).toBeGreaterThan(0);
  });
});

describe('buildTree', () => {
  it('keeps a small set as one leaf', () => {
    const tree = buildTree([cube(0, 0, 20), cube(50, 50, 20)], SQUARE);
    expect(tree.children).toHaveLength(0);
    expect(tree.buildings).toHaveLength(2);
  });

  it('splits a crowded extent', () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      cube((i % 20) * 90 - 900, Math.floor(i / 20) * 90 - 900, 20),
    );
    const tree = buildTree(many, SQUARE);
    expect(tree.children.length).toBeGreaterThan(0);
  });

  it('places every building exactly once', () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      cube((i % 25) * 70 - 850, Math.floor(i / 25) * 90 - 900, 10 + (i % 40)),
    );
    const tree = buildTree(many, SQUARE);
    const placed = flatten(tree).reduce((n, node) => n + node.buildings.length, 0);
    // Drawn twice would z-fight with itself; dropped would be a hole in the
    // city that nobody could trace back to here.
    expect(placed).toBe(many.length);
  });

  it('holds the tall buildings at the root', () => {
    const many = [
      cube(0, 0, 380),
      ...Array.from({ length: 400 }, (_, i) =>
        cube((i % 20) * 90 - 900, Math.floor(i / 20) * 90 - 900, 12),
      ),
    ];
    const tree = buildTree(many, SQUARE);
    /**
     * The single most important property in the file.
     *
     * A tower visible from two kilometres has to be in a tile the renderer
     * loads from two kilometres, and it only loads a leaf when it is close.
     * If this fails, the skyline dissolves as you pull back — and it would
     * look like a level-of-detail setting rather than a partitioning bug.
     */
    expect(tree.buildings.some((b) => b.height === 380)).toBe(true);
  });

  it('does not recurse forever on a dense point', () => {
    // Five hundred buildings stacked in one spot: the split can never separate
    // them, so only the depth cap stops it.
    const stacked = Array.from({ length: 500 }, () => cube(0, 0, 10));
    const tree = buildTree(stacked, SQUARE);
    const deepest = Math.max(...flatten(tree).map((n) => n.depth));
    expect(deepest).toBeLessThanOrEqual(6);
  });
});

describe('mergeNode', () => {
  it('offsets the indices of every building after the first', () => {
    const tree = buildTree([cube(0, 0, 10), cube(100, 0, 10)], SQUARE);
    const merged = mergeNode(tree);
    expect(merged.position.length / 3).toBe(8);
    expect(merged.index.length).toBe(12);
    // The second building's indices must point at its own vertices, not the
    // first's — the classic merge bug, and it renders as one building
    // smeared across two footprints.
    expect(Math.max(...merged.index)).toBe(7);
    expect(Math.min(...merged.index.slice(6))).toBeGreaterThanOrEqual(4);
  });

  it('produces an empty mesh for an empty node', () => {
    const tree = buildTree([], SQUARE);
    const merged = mergeNode(tree);
    expect(merged.index.length).toBe(0);
  });
});

describe('toTilesetJson', () => {
  const tree = buildTree(
    Array.from({ length: 400 }, (_, i) =>
      cube((i % 20) * 90 - 900, Math.floor(i / 20) * 90 - 900, 10 + (i % 60)),
    ),
    SQUARE,
  );
  const doc = toTilesetJson(tree) as {
    asset: { version: string };
    geometricError: number;
    root: Record<string, unknown>;
  };

  it('declares a version the renderer accepts', () => {
    expect(doc.asset.version).toBe('1.1');
  });

  it('gives the root a larger error than any child', () => {
    const root = doc.root as { geometricError: number; children?: { geometricError: number }[] };
    for (const child of root.children ?? []) {
      expect(child.geometricError).toBeLessThan(root.geometricError);
    }
  });

  it('refines by ADD, so the skyline is not swapped out', () => {
    expect((doc.root as { refine: string }).refine).toBe('ADD');
  });

  it('writes a twelve-number box for every bounding volume', () => {
    const walk = (node: Record<string, unknown>) => {
      const volume = node.boundingVolume as { box: number[] };
      expect(volume.box).toHaveLength(12);
      expect(volume.box.every(Number.isFinite)).toBe(true);
      for (const child of (node.children as Record<string, unknown>[]) ?? []) walk(child);
    };
    walk(doc.root);
  });

  it('points every content uri at a tile that has geometry', () => {
    const nodes = flatten(tree);
    const withContent = new Set(
      nodes.filter((n) => n.buildings.length > 0).map((n) => `${n.key}.glb`),
    );
    const walk = (node: Record<string, unknown>) => {
      const content = node.content as { uri: string } | undefined;
      if (content) expect(withContent.has(content.uri)).toBe(true);
      for (const child of (node.children as Record<string, unknown>[]) ?? []) walk(child);
    };
    walk(doc.root);
  });
});

describe('writeGlb', () => {
  const mesh = mergeNode(buildTree([cube(0, 0, 30)], SQUARE));
  const glb = writeGlb(mesh);
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);

  it('starts with the glTF magic and version 2', () => {
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
  });

  it('declares its own total length', () => {
    expect(view.getUint32(8, true)).toBe(glb.byteLength);
  });

  it('pads both chunks to four bytes', () => {
    const jsonLength = view.getUint32(12, true);
    expect(jsonLength % 4).toBe(0);
    const binLength = view.getUint32(20 + jsonLength, true);
    // Unpadded chunks load in some viewers and not others, which is the worst
    // kind of broken: it works on the machine it was written on.
    expect(binLength % 4).toBe(0);
  });

  it('pads the JSON chunk with spaces, not zeros', () => {
    const jsonLength = view.getUint32(12, true);
    const bytes = glb.slice(20, 20 + jsonLength);
    const text = new TextDecoder().decode(bytes);
    // A zero byte here makes the JSON unparseable in a strict loader.
    expect(() => JSON.parse(text.trim())).not.toThrow();
  });

  it('carries min and max on POSITION, which the spec requires', () => {
    const jsonLength = view.getUint32(12, true);
    const doc = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLength)).trim());
    const position = doc.accessors[0];
    expect(position.min).toHaveLength(3);
    expect(position.max).toHaveLength(3);
    expect(position.min.every(Number.isFinite)).toBe(true);
  });

  it('converts Z-up to glTF Y-up', () => {
    const jsonLength = view.getUint32(12, true);
    const doc = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLength)).trim());
    // The cube's highest point is 30 m up in the scene frame; in glTF that is
    // +Y. Getting this wrong lays the whole city on its side.
    expect(doc.accessors[0].max[1]).toBeCloseTo(30);
  });

  it('survives an empty mesh rather than writing a corrupt file', () => {
    const empty = writeGlb({
      position: new Float32Array(0),
      normal: new Float32Array(0),
      index: new Uint32Array(0),
    });
    const emptyView = new DataView(empty.buffer, empty.byteOffset, empty.byteLength);
    expect(emptyView.getUint32(0, true)).toBe(0x46546c67);
  });
});
