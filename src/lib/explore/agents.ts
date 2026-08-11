import type { RoadSegment } from '@/lib/streetscape';
import { seededUnit } from '@/lib/roofscape';
import { ringToLocal, type LocalFrame } from './frame';

/**
 * Cars and people, on the streets that are actually there.
 *
 * The plan is specific about what this is and is not: instanced meshes on the
 * existing street graph, timed paths, no traffic simulation and no pedestrian
 * AI. Those are stated non-goals, and they are non-goals for a reason — a
 * queue forming at a junction is a thing a viewer watches, and this map's
 * subject is a Goldenrod band on the 14th floor.
 *
 * What movement buys is scale. A city with nothing moving in it reads as a
 * model of a city; a few hundred cars crawling along the avenues reads as a
 * place, and the difference costs two draw calls.
 *
 * Everything here is pure and deterministic. Seeded from each road's own
 * geometry, so the same street has the same traffic on every reload and on
 * every machine — a screenshot taken twice has to look the same twice.
 */

export interface Agent {
  /** The polyline this agent travels, in scene metres. */
  path: [number, number][];
  /** Cumulative length at each vertex, so a position is one lookup. */
  cumulative: number[];
  /** Total path length, in metres. */
  length: number;
  /** Metres travelled from the start of the path. Wraps. */
  distance: number;
  /** Metres per second. */
  speed: number;
  /** Metres to the right of the centreline. Lanes and pavements. */
  offset: number;
  /** Metres above the ground the agent's origin sits at. */
  z: number;
}

export interface AgentPose {
  x: number;
  y: number;
  z: number;
  /** Radians, the direction of travel, measured from +X toward +Y. */
  heading: number;
}

/** Feet to metres, for the roadbed widths the streetscape publishes. */
const FT_TO_M = 0.3048;

/**
 * Road tiers agents use.
 *
 * Tier 0 is highways, bridges and ramps — which really do carry traffic, but
 * they also carry it at fifty miles an hour through the middle of a scene
 * whose camera is standing on a pavement. They are left out for the same
 * reason the walk graph leaves them out.
 */
function usable(road: RoadSegment): boolean {
  return road.t !== 0 && road.p.length >= 2 && road.w > 0;
}

function cumulativeOf(path: [number, number][]): { cumulative: number[]; length: number } {
  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    cumulative.push(total);
  }
  return { cumulative, length: total };
}

export interface PopulateOptions {
  /** Roughly how many agents to place, across all roads. */
  count: number;
  /** Metres per second, before the per-agent variation. */
  speed: number;
  /** Where in the street they travel: 'road' for lanes, 'kerb' for pavements. */
  lane: 'road' | 'kerb';
  /** Metres above the ground the agent stands on. */
  z: number;
  /** Shortest road worth putting anything on, in metres. */
  minLengthM?: number;
}

/**
 * Agents distributed along the street network in view.
 *
 * Longer roads get more, because they are longer — a fixed number per segment
 * puts as much traffic on a fifteen-metre stub as on the length of Fifth
 * Avenue, and the stub is what you notice.
 *
 * Direction alternates by segment index rather than at random, so both sides
 * of a two-way street are occupied. Cars all travelling the same way down
 * every avenue is the single most obviously wrong thing this could do, and
 * Manhattan's avenues really are one-way — but not all the same way.
 */
export function populate(
  frame: LocalFrame,
  roads: RoadSegment[],
  options: PopulateOptions,
): Agent[] {
  const usableRoads = roads.filter(usable);
  if (usableRoads.length === 0 || options.count <= 0) return [];

  const minLength = options.minLengthM ?? 30;
  const prepared: { path: [number, number][]; cumulative: number[]; length: number; w: number }[] = [];
  let totalLength = 0;

  for (const road of usableRoads) {
    const path = ringToLocal(frame, road.p);
    const { cumulative, length } = cumulativeOf(path);
    if (length < minLength) continue;
    prepared.push({ path, cumulative, length, w: road.w });
    totalLength += length;
  }
  if (prepared.length === 0) return [];

  const perMetre = options.count / totalLength;
  const agents: Agent[] = [];

  /**
   * The remainder is carried between roads, not rounded away on each.
   *
   * With four hundred agents spread over a couple of hundred kilometres of
   * centreline, most segments are owed a fraction of one — and rounding each
   * to zero independently produced two cars for the whole of Midtown. The
   * street network is made of short segments; a scheme that only populates
   * long ones populates almost nothing.
   */
  let owed = 0;

  for (let i = 0; i < prepared.length; i++) {
    const road = prepared[i];
    owed += road.length * perMetre;
    const want = Math.floor(owed);
    owed -= want;
    if (want <= 0) continue;

    // Seeded from the road's own first vertex, so the same street always has
    // the same traffic on it.
    const key = `${road.path[0][0].toFixed(1)},${road.path[0][1].toFixed(1)}`;
    const halfRoad = (road.w * FT_TO_M) / 2;

    for (let n = 0; n < want; n++) {
      const jitter = seededUnit(key, n * 7 + 1);
      const side = (i + n) % 2 === 0 ? 1 : -1;

      const offset =
        options.lane === 'road'
          ? side * halfRoad * (0.32 + jitter * 0.34)
          : // The pavement: outside the kerb, with a metre or so of variation
            // so a queue of people does not walk in single file.
            side * (halfRoad + 1.4 + jitter * 1.8);

      agents.push({
        path: road.path,
        cumulative: road.cumulative,
        length: road.length,
        distance: ((n + jitter) / Math.max(1, want)) * road.length,
        // Direction is carried in the sign of the speed, which keeps a step
        // to one addition and makes reversing a road a one-character change.
        speed: side * options.speed * (0.72 + seededUnit(key, n * 7 + 2) * 0.56),
        offset,
        z: options.z,
      });
    }
  }

  return agents;
}

/** Advances every agent, wrapping at the ends of its own path. */
export function stepAgents(agents: Agent[], dt: number): void {
  // A backgrounded tab hands back several seconds. Unclamped, every agent
  // teleports and the whole street resets at once, which is far more visible
  // than the frames that were missed.
  const step = Math.min(Math.max(dt, 0), 0.25);
  for (const a of agents) {
    a.distance += a.speed * step;
    if (a.length <= 0) continue;
    // Modulo, so a long pause does not need a loop to unwind.
    a.distance = ((a.distance % a.length) + a.length) % a.length;
  }
}

/**
 * Where an agent is and which way it faces.
 *
 * Binary search over the cumulative lengths rather than a walk, because this
 * runs for every agent every frame and a walk is O(vertices) on a polyline
 * that can have hundreds.
 */
export function poseOf(agent: Agent): AgentPose {
  const { path, cumulative } = agent;
  if (path.length < 2) {
    return { x: path[0]?.[0] ?? 0, y: path[0]?.[1] ?? 0, z: agent.z, heading: 0 };
  }

  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] <= agent.distance) lo = mid;
    else hi = mid;
  }

  const segmentLength = Math.max(1e-6, cumulative[hi] - cumulative[lo]);
  const t = Math.min(1, Math.max(0, (agent.distance - cumulative[lo]) / segmentLength));

  const ax = path[lo][0];
  const ay = path[lo][1];
  const bx = path[hi][0];
  const by = path[hi][1];

  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  // The lateral offset is applied along the segment's right-hand normal, so
  // an agent stays in its lane round a bend rather than cutting the corner.
  const nx = dy / len;
  const ny = -dx / len;

  const forward = agent.speed >= 0 ? 1 : -1;

  return {
    x: ax + dx * t + nx * agent.offset,
    y: ay + dy * t + ny * agent.offset,
    z: agent.z,
    heading: Math.atan2(dy * forward, dx * forward),
  };
}
