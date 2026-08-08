import { metersBetween } from './transit';
import type { RoadSegment } from './streetscape';

/**
 * Walking routes along the streets that are actually drawn.
 *
 * The previous routes were a synthetic L: take the long leg along "the
 * avenue", turn, take the short leg along "the street", where both directions
 * came from one hard-coded bearing for the whole of Manhattan. With no street
 * geometry on the map that read as plausible. Once the real centrelines were
 * being drawn underneath it, it stopped being plausible and started being
 * obviously wrong — a line setting off at its own angle, crossing blocks and
 * cutting corners that visibly are not there. Below Houston, where the grid
 * bearing assumption is simply false, it was nonsense.
 *
 * So this routes on the real thing. The centrelines are already loaded for the
 * ground plane, they are already noded at intersections by the city, and they
 * already carry the geometry the eye is comparing the route against. A route
 * computed on them lies along the streets on screen because it IS the streets
 * on screen.
 */

/** Coordinates are snapped to this before being used as a node key. */
const NODE_PRECISION = 1e-5;

/** How far from a road a point may be and still be routed from, in metres. */
const MAX_SNAP_M = 220;

/**
 * A guard on effort, not on distance. Manhattan blocks are small, so a walk
 * worth drawing settles well inside this; a pathological request stops rather
 * than freezing the frame.
 */
const MAX_EXPANSIONS = 20_000;

export interface WalkGraph {
  /** Node key → its coordinate. */
  nodes: Map<string, [number, number]>;
  /** Node key → [neighbour key, length in metres][]. */
  edges: Map<string, [string, number][]>;
  /** Coarse spatial index over node keys, for snapping. */
  cells: Map<string, string[]>;
  cellSize: number;
}

function nodeKey(lon: number, lat: number): string {
  return `${Math.round(lon / NODE_PRECISION)},${Math.round(lat / NODE_PRECISION)}`;
}

/** ~110m cells, the same scale the road index uses. */
const CELL = 0.001;
const cellKey = (lon: number, lat: number) =>
  `${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`;

/**
 * Road tiers that a person can walk along.
 *
 * Tier 0 is highways, bridges and ramps. Routing a pedestrian down the FDR
 * Drive is worse than not routing at all — it is confidently wrong, and the
 * walk time printed beside it would be a lie.
 */
function walkable(road: RoadSegment): boolean {
  return road.t !== 0;
}

export function buildWalkGraph(roads: RoadSegment[]): WalkGraph {
  const graph: WalkGraph = {
    nodes: new Map(),
    edges: new Map(),
    cells: new Map(),
    cellSize: CELL,
  };

  const addNode = (p: [number, number]): string => {
    const key = nodeKey(p[0], p[1]);
    if (!graph.nodes.has(key)) {
      graph.nodes.set(key, p);
      const ck = cellKey(p[0], p[1]);
      const bucket = graph.cells.get(ck);
      if (bucket) bucket.push(key);
      else graph.cells.set(ck, [key]);
    }
    return key;
  };

  const addEdge = (a: string, b: string, meters: number) => {
    if (a === b) return;
    const from = graph.edges.get(a);
    if (from) from.push([b, meters]);
    else graph.edges.set(a, [[b, meters]]);
  };

  for (const road of roads) {
    if (!walkable(road)) continue;
    for (let i = 1; i < road.p.length; i++) {
      const a = road.p[i - 1];
      const b = road.p[i];
      const meters = metersBetween(a, b);
      if (meters === 0) continue;
      const ka = addNode(a);
      const kb = addNode(b);
      // Undirected: one-way streets do not apply to walking.
      addEdge(ka, kb, meters);
      addEdge(kb, ka, meters);
    }
  }

  return graph;
}

/** The nearest graph node to a point, or null when nothing is close enough. */
export function nearestNode(
  graph: WalkGraph,
  point: [number, number],
  maxMeters = MAX_SNAP_M,
): string | null {
  const cx = Math.floor(point[0] / graph.cellSize);
  const cy = Math.floor(point[1] / graph.cellSize);

  let best: string | null = null;
  let bestDist = Infinity;

  // Widening rings, so a point in an empty cell still finds its street.
  for (let ring = 0; ring <= 2; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        // Only the newly added ring, not the block already searched.
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const keys = graph.cells.get(`${cx + dx},${cy + dy}`);
        if (!keys) continue;
        for (const key of keys) {
          const node = graph.nodes.get(key)!;
          const d = metersBetween(point, node);
          if (d < bestDist) {
            bestDist = d;
            best = key;
          }
        }
      }
    }
    if (best && bestDist <= maxMeters) return best;
  }

  return best !== null && bestDist <= maxMeters ? best : null;
}

/**
 * Shortest walking path between two points, following the streets.
 *
 * A* with straight-line distance as the heuristic. That heuristic never
 * overestimates the real walking distance, so the first time the destination
 * is taken off the queue it is genuinely the shortest route — no second-guess
 * pass, and no risk of drawing a route that is not the one the walk time was
 * computed from.
 *
 * Returns null rather than a guess when either end is nowhere near a street,
 * so the caller can fall back deliberately.
 */
export function routeOnStreets(
  graph: WalkGraph,
  from: [number, number],
  to: [number, number],
): [number, number][] | null {
  const start = nearestNode(graph, from);
  const goal = nearestNode(graph, to);
  if (!start || !goal) return null;
  if (start === goal) return [from, graph.nodes.get(start)!, to];

  const goalPoint = graph.nodes.get(goal)!;
  const cameFrom = new Map<string, string>();
  const best = new Map<string, number>([[start, 0]]);
  const settled = new Set<string>();

  // A binary heap is not worth it at this size — a viewport holds a few
  // thousand nodes and a Manhattan walk settles in a few hundred expansions.
  const open: [string, number][] = [[start, metersBetween(graph.nodes.get(start)!, goalPoint)]];

  let expansions = 0;
  while (open.length > 0 && expansions++ < MAX_EXPANSIONS) {
    let pick = 0;
    for (let i = 1; i < open.length; i++) if (open[i][1] < open[pick][1]) pick = i;
    const [current] = open.splice(pick, 1)[0];
    if (current === goal) break;
    if (settled.has(current)) continue;
    settled.add(current);

    const g = best.get(current) ?? Infinity;
    for (const [next, meters] of graph.edges.get(current) ?? []) {
      if (settled.has(next)) continue;
      const candidate = g + meters;
      if (candidate >= (best.get(next) ?? Infinity)) continue;
      best.set(next, candidate);
      cameFrom.set(next, current);
      open.push([next, candidate + metersBetween(graph.nodes.get(next)!, goalPoint)]);
    }
  }

  if (!best.has(goal)) return null;

  const path: [number, number][] = [];
  for (let at: string | undefined = goal; at; at = cameFrom.get(at)) {
    path.push(graph.nodes.get(at)!);
    if (at === start) break;
  }
  path.reverse();

  // The stubs from the doorway to the kerb and from the kerb to the entrance
  // are part of the walk, and without them the line starts in mid-air.
  return [from, ...path, to];
}

/** Graphs are cached per fetched road payload — building one is not cheap. */
const graphCache = new WeakMap<RoadSegment[], WalkGraph>();

export function walkGraphFor(roads: RoadSegment[]): WalkGraph {
  let graph = graphCache.get(roads);
  if (!graph) {
    graph = buildWalkGraph(roads);
    graphCache.set(roads, graph);
  }
  return graph;
}
