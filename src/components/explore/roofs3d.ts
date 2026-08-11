import type { Building } from '@/types';
import type { Massing } from '@/lib/citygml';
import { computeRoofscape, type Roofscape } from '@/lib/roofscape';
import { FT_TO_M } from '@/lib/floor-bands';
import { ringToLocal, toLngLat, makeFrame, type LocalFrame } from '@/lib/explore/frame';
import {
  extrudedMassing,
  mergeMassings,
  type MassingArrays,
} from '@/lib/explore/massing';
import { sectionAt } from '@/lib/explore/lod2';

/**
 * The roofscape, as geometry rather than as a proxy.
 *
 * `lib/roofscape.ts` already derives what happens at the top of a building —
 * parapet, setback tiers, mechanical plant, water tanks, masts — from
 * footprint, height, floor count and year built, deterministically and with no
 * hand authoring. It is tested and it is right; sprint 5 is not about
 * rederiving any of it. What deck.gl drew from it were proxies: columns for
 * tanks, flat collars for parapets, boxes for plant. This turns each into a
 * real mesh in the same buffer as the facades, so it is lit by the same sun,
 * hazed by the same air, and occludes and is occluded properly.
 *
 * **Where the furniture goes on a surveyed building.**
 *
 * A derived roofscape assumes the roof is at `height_roof_ft` and has the
 * footprint's outline. On a building carrying NYC's surveyed massing neither
 * is true: the roof is wherever the model says, at several elevations on a
 * stepped tower, and its outline up there is the shaft rather than the plot.
 * Placing derived furniture at the footprint's height on a surveyed tower puts
 * a water tank in mid-air beside the building — the same class of error as a
 * band drawn on the plot, and just as visible.
 *
 * So a surveyed building has its roofscape derived against its own crown: the
 * elevation of its largest roof surface, and the cross-section there. Which
 * means the generator is reused unchanged, handed a building whose footprint
 * and height describe the tower rather than the plot.
 */

/** The main roof of a surveyed building: elevation and outline. */
export interface RoofPlatform {
  zM: number;
  ring: [number, number][];
  /** Rough area in square metres, used to pick the crown from the terraces. */
  areaM2: number;
}

/**
 * The roof surfaces worth putting furniture on.
 *
 * Sorted by area, because the biggest one is the roof and the rest are
 * setback terraces, lift overrun caps and the tops of parapet returns. A
 * water tank belongs on the first and nowhere near the last.
 *
 * The mast is deliberately excluded by the area test rather than by height:
 * on the Empire State Building the topmost surface is a few square metres of
 * antenna cap, and putting the building's plant room on it would be absurd in
 * a way that is very easy to ship.
 */
export function roofPlatforms(massing: Massing, minAreaM2 = 150): RoofPlatform[] {
  const out: RoofPlatform[] = [];

  for (const s of massing.surfaces) {
    if (s.k !== 'R' || s.p.length < 9) continue;

    let minZ = Infinity;
    let maxZ = -Infinity;
    let area = 0;
    const n = s.p.length / 3;
    for (let i = 0; i < n; i++) {
      const z = s.p[i * 3 + 2];
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      const j = (i + 1) % n;
      area += s.p[i * 3] * s.p[j * 3 + 1] - s.p[j * 3] * s.p[i * 3 + 1];
    }
    area = Math.abs(area / 2);
    // Only flat roofs. A pitched or sloped surface is not somewhere plant
    // stands, and Manhattan's commercial stock is flat-roofed anyway.
    if (maxZ - minZ > 1.5) continue;
    if (area < minAreaM2) continue;

    out.push({ zM: (minZ + maxZ) / 2, ring: [], areaM2: area });
  }

  out.sort((a, b) => b.areaM2 - a.areaM2);
  return out;
}

/**
 * A surveyed building's crown, as something the roofscape generator can read.
 *
 * Returns null when the model has no roof worth standing on, which sends the
 * caller back to the footprint — the honest fallback everywhere else in this
 * mode.
 */
export function crownOf(massing: Massing, minAreaM2 = 150): RoofPlatform | null {
  const platforms = roofPlatforms(massing, minAreaM2);
  if (platforms.length === 0) return null;

  // The largest surface, and its outline taken as a slice just below itself —
  // a slice AT the roof plane catches the roof's own edges rather than the
  // walls under it, and comes back empty or ragged.
  const main = platforms[0];
  const frame = makeFrame(massing.anchor[0], massing.anchor[1]);
  const section = sectionAt(massing, main.zM - 0.6);
  if (section.length < 3) return null;

  return {
    ...main,
    ring: section.map(([x, y]) => toLngLat(frame, x, y)),
  };
}

/** A cylinder standing on its base, in scene metres. */
export function cylinder(
  cx: number,
  cy: number,
  radiusM: number,
  baseM: number,
  heightM: number,
  sides = 10,
): MassingArrays {
  const ring: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push([cx + Math.cos(a) * radiusM, cy + Math.sin(a) * radiusM]);
  }
  // Ten sides, not thirty-two. A water tank on a Manhattan roof is a few
  // pixels tall from anywhere this map is read, and the silhouette is the
  // whole point of it — smoothness is not.
  return extrudedMassing(ring, baseM + heightM, baseM);
}

/**
 * A parapet: a wall around the roof edge, with a lid, and hollow inside.
 *
 * Drawn as two wall loops and an annulus between them rather than as a solid
 * slab, because a solid parapet seen from above is a plate covering the roof —
 * which hides the plant and tanks standing on it, and those are the whole
 * reason the roof is interesting.
 */
export function parapetMassing(
  outer: [number, number][],
  inner: [number, number][],
  baseM: number,
  heightM: number,
): MassingArrays {
  if (outer.length < 3 || outer.length !== inner.length) {
    return extrudedMassing(outer, baseM + heightM, baseM);
  }

  const topM = baseM + heightM;
  const position: number[] = [];
  const normal: number[] = [];
  const along: number[] = [];
  const up: number[] = [];
  const wall: number[] = [];
  const isWall: number[] = [];
  const index: number[] = [];

  const push = (
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    s: number, isW: number,
  ) => {
    position.push(x, y, z);
    normal.push(nx, ny, nz);
    along.push(s);
    up.push(z);
    wall.push(heightM);
    isWall.push(isW);
  };

  let travelled = 0;
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    const [ax, ay] = outer[i];
    const [bx, by] = outer[j];
    const [ix, iy] = inner[i];
    const [jx, jy] = inner[j];

    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;
    const nx = ey / len;
    const ny = -ex / len;

    // Outer face.
    let base = position.length / 3;
    push(ax, ay, baseM, nx, ny, 0, travelled, 1);
    push(bx, by, baseM, nx, ny, 0, travelled + len, 1);
    push(bx, by, topM, nx, ny, 0, travelled + len, 1);
    push(ax, ay, topM, nx, ny, 0, travelled, 1);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);

    // Inner face, wound the other way so its normal points into the roof.
    base = position.length / 3;
    push(jx, jy, baseM, -nx, -ny, 0, travelled + len, 1);
    push(ix, iy, baseM, -nx, -ny, 0, travelled, 1);
    push(ix, iy, topM, -nx, -ny, 0, travelled, 1);
    push(jx, jy, topM, -nx, -ny, 0, travelled + len, 1);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);

    // The coping on top, between the two.
    base = position.length / 3;
    push(ax, ay, topM, 0, 0, 1, 0, 0);
    push(bx, by, topM, 0, 0, 1, 0, 0);
    push(jx, jy, topM, 0, 0, 1, 0, 0);
    push(ix, iy, topM, 0, 0, 1, 0, 0);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);

    travelled += len;
  }

  return {
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    along: new Float32Array(along),
    up: new Float32Array(up),
    wall: new Float32Array(wall),
    isWall: new Float32Array(isWall),
    index: new Uint32Array(index),
    triangles: index.length / 3,
  };
}

/** Everything on one building's roof, as one buffer in scene metres. */
export function roofMassing(frame: LocalFrame, scape: Roofscape): MassingArrays | null {
  const parts: MassingArrays[] = [];

  const bandOf = (b: { rings: [number, number][][]; baseFt: number; heightFt: number }) => {
    const outer = ringToLocal(frame, b.rings[0]);
    const inner = ringToLocal(frame, b.rings[1] ?? b.rings[0]);
    return parapetMassing(outer, inner, b.baseFt * FT_TO_M, b.heightFt * FT_TO_M);
  };

  if (scape.parapet) parts.push(bandOf(scape.parapet));
  for (const s of scape.setbacks) parts.push(bandOf(s));

  for (const box of scape.bulkheads) {
    parts.push(
      extrudedMassing(
        ringToLocal(frame, box.ring),
        (box.baseFt + box.heightFt) * FT_TO_M,
        box.baseFt * FT_TO_M,
      ),
    );
  }

  for (const c of [...scape.tanks, ...scape.posts]) {
    const [cx, cy] = ringToLocal(frame, [c.center])[0];
    parts.push(
      cylinder(cx, cy, c.radiusM, c.baseFt * FT_TO_M, c.heightFt * FT_TO_M),
    );
  }

  const merged = parts.filter((p) => p.triangles > 0);
  return merged.length > 0 ? mergeMassings(merged) : null;
}

/**
 * The roofscape for one building, placed on the crown it actually has.
 *
 * `surveyed` is the building's massing where the city has one. Handing the
 * generator a building whose footprint is the tower's own cross-section and
 * whose height is the tower's own roof is what keeps a water tank on the roof
 * rather than in the air beside it.
 */
export function roofscapeFor(
  building: Building,
  surveyed: Massing | null,
): Roofscape {
  if (!surveyed) return computeRoofscape(building);

  const crown = crownOf(surveyed);
  if (!crown) return computeRoofscape(building);

  return computeRoofscape({
    ...building,
    footprint: crown.ring,
    height_roof_ft: crown.zM / FT_TO_M,
    // The floor height must keep coming from the real data. It is what sets
    // how tall a bulkhead is, and deriving it from a surveyed crown that
    // includes a mast would make every plant room a storey too tall.
    floor_height_override: building.floor_height_override,
  });
}
