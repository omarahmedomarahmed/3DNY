/**
 * A quadtree of city massing, and the 3-D Tiles document that describes it.
 *
 * ## Why this exists
 *
 * Explore mode ships one flat asset: every surveyed building in one JSON file,
 * loaded whole, held in memory whole. For seventy-three towers that is 150 KB
 * and perfectly sensible. For every building in Manhattan it is tens of
 * megabytes, and the browser has to parse and upload all of it before anything
 * appears — including the forty thousand buildings behind the camera.
 *
 * The fix is the one every serious 3-D city viewer uses, and both of the
 * demos worth comparing against use it: **3-D Tiles**. Geometry is bucketed
 * into a spatial tree, each node carries a *geometric error* saying how wrong
 * it is to stop there, and the renderer walks the tree each frame loading only
 * the nodes whose error would exceed a pixel budget on screen. Detail arrives
 * where you are looking and nowhere else.
 *
 * This module is the build-time half: the tree, the bounding volumes, the
 * geometric errors and the `tileset.json`. `glb.ts` writes the content.
 *
 * ## The geometric error, which is the whole trick
 *
 * A tile's geometric error is "how much visible error remains if you render
 * this tile and none of its children", in metres. The renderer converts it to
 * pixels using the camera and refines while it exceeds `errorTarget`. Getting
 * it wrong is the classic failure: too high and nothing ever refines, too low
 * and everything loads at once and the format buys you nothing.
 *
 * Here a node's error is its own extent divided by a constant — a tile 400 m
 * across is "about 12 m wrong" — which is the standard heuristic for massing
 * where each level roughly halves the footprint. Leaves are zero: there is
 * nothing below them, so stopping there is exact.
 */

export interface TiledBuilding {
  /** Scene metres, this project's frame. */
  position: Float32Array;
  normal: Float32Array;
  index: Uint32Array;
  /** Centroid in scene metres, for bucketing. */
  cx: number;
  cy: number;
  /** Metres. Drives which level the building is coarse enough to sit at. */
  height: number;
}

export interface TileNode {
  /** Path segment, e.g. `0/1/2`. Content is written as `<key>.glb`. */
  key: string;
  /** Scene metres: west, south, east, north. */
  bounds: [number, number, number, number];
  minZ: number;
  maxZ: number;
  buildings: TiledBuilding[];
  children: TileNode[];
  depth: number;
}

/** Below this many buildings a node is a leaf whatever its size. */
const SPLIT_AT = 220;

/** And never deeper than this, so a dense block cannot recurse forever. */
const MAX_DEPTH = 6;

/**
 * Error, in metres, for a tile of a given width.
 *
 * A sixteenth of the tile's own extent. The constant is not derived from
 * anything — it is the ratio that makes a Manhattan block refine at about the
 * distance you would want it to, and it is the one number here worth tuning
 * against a real frame rate.
 */
export function geometricErrorFor(widthM: number): number {
  return widthM / 16;
}

/**
 * Builds the tree.
 *
 * Split by count rather than by area: Midtown has forty buildings to a block
 * and the Battery has four, and a fixed grid would give one tile of nothing
 * and another of everything. A building belongs to exactly one node — the
 * deepest one containing its centroid — so nothing is drawn twice.
 *
 * **Tall buildings are held at coarser levels.** A tower visible from two
 * kilometres must be in a tile the renderer loads from two kilometres, and the
 * renderer only loads a leaf when it is close. Pushing anything over
 * `keepAtDepth` metres up the tree is what stops the skyline dissolving as you
 * pull back — the single most important detail in this file.
 */
export function buildTree(
  buildings: TiledBuilding[],
  bounds: [number, number, number, number],
  depth = 0,
  key = 'r',
): TileNode {
  const node: TileNode = {
    key,
    bounds,
    minZ: 0,
    maxZ: 0,
    buildings: [],
    children: [],
    depth,
  };

  let maxZ = 0;
  for (const b of buildings) maxZ = Math.max(maxZ, b.height);
  node.maxZ = maxZ;

  const [w, s, e, n] = bounds;
  const width = e - w;

  if (buildings.length <= SPLIT_AT || depth >= MAX_DEPTH) {
    node.buildings = buildings;
    return node;
  }

  /**
   * What stays here, and what goes down.
   *
   * A building is kept at this level if it is tall enough to matter at this
   * level's viewing distance. The threshold falls with depth, so the Empire
   * State Building sits at the root, a twenty-storey block sits two levels
   * down, and a six-storey loft is a leaf.
   */
  const keepAtDepth = [180, 90, 45, 22, 11, 0, 0][depth] ?? 0;
  const keep: TiledBuilding[] = [];
  const descend: TiledBuilding[] = [];
  for (const b of buildings) {
    (b.height >= keepAtDepth ? keep : descend).push(b);
  }
  node.buildings = keep;

  const midX = (w + e) / 2;
  const midY = (s + n) / 2;
  const quads: [number, number, number, number][] = [
    [w, s, midX, midY],
    [midX, s, e, midY],
    [w, midY, midX, n],
    [midX, midY, e, n],
  ];

  quads.forEach((quad, i) => {
    const inside = descend.filter(
      (b) => b.cx >= quad[0] && b.cx < quad[2] && b.cy >= quad[1] && b.cy < quad[3],
    );
    if (inside.length === 0) return;
    node.children.push(buildTree(inside, quad, depth + 1, `${key}-${i}`));
  });

  // A node that kept nothing and split into one child is a wasted level.
  void width;
  return node;
}

/** Merges a node's buildings into one mesh. */
export function mergeNode(node: TileNode): {
  position: Float32Array;
  normal: Float32Array;
  index: Uint32Array;
} {
  let vertices = 0;
  let indices = 0;
  for (const b of node.buildings) {
    vertices += b.position.length / 3;
    indices += b.index.length;
  }

  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const index = new Uint32Array(indices);

  let vOffset = 0;
  let iOffset = 0;
  for (const b of node.buildings) {
    position.set(b.position, vOffset * 3);
    normal.set(b.normal, vOffset * 3);
    for (let i = 0; i < b.index.length; i++) index[iOffset + i] = b.index[i] + vOffset;
    vOffset += b.position.length / 3;
    iOffset += b.index.length;
  }

  return { position, normal, index };
}

/**
 * The `tileset.json` document.
 *
 * Bounding volumes are `box`, in the tileset's own coordinate system, which is
 * this project's scene frame in metres — so the renderer needs one transform
 * from scene metres to wherever it is placed, and that is the identity here
 * because `ExploreLayer` already works in exactly this frame.
 *
 * A `box` is a centre followed by three half-axis vectors. Written
 * axis-aligned, because a quadtree of a city is.
 */
export function toTilesetJson(root: TileNode, version = '1.1'): unknown {
  const describe = (node: TileNode): Record<string, unknown> => {
    const [w, s, e, n] = node.bounds;
    const cx = (w + e) / 2;
    const cy = (s + n) / 2;
    const hx = (e - w) / 2;
    const hy = (n - s) / 2;
    const hz = Math.max(node.maxZ, 1) / 2;

    const out: Record<string, unknown> = {
      boundingVolume: {
        // Centre, then the three half-axes. Z is up in the tileset's frame and
        // the renderer is given the same up axis, so no rotation is needed.
        box: [cx, cy, hz, hx, 0, 0, 0, hy, 0, 0, 0, hz],
      },
      geometricError: node.children.length > 0 ? geometricErrorFor(e - w) : 0,
      // ADD, not REPLACE: a parent's tall towers stay drawn while its children
      // bring in the low-rise around them. REPLACE would swap the skyline out
      // for a block of shops every time you flew closer.
      refine: 'ADD',
    };

    if (node.buildings.length > 0) {
      out.content = { uri: `${node.key}.glb` };
    }
    if (node.children.length > 0) {
      out.children = node.children.map(describe);
    }
    return out;
  };

  const [w, s, e, n] = root.bounds;
  return {
    asset: { version, tilesetVersion: '1.0.0' },
    geometricError: geometricErrorFor(e - w) * 2,
    root: describe(root),
  };
}

/** Every node in the tree, depth first. For writing content. */
export function flatten(node: TileNode): TileNode[] {
  return [node, ...node.children.flatMap(flatten)];
}
