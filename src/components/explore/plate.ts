import type { BuildingWithSpaces } from '@/types';
import { buildingRing, floorHeightFt, FT_TO_M } from '@/lib/floor-bands';
import { ringToLocal, toCCW, openRing, type LocalFrame } from '@/lib/explore/frame';
import { surveyedSectionAt } from '@/lib/explore/lod2-registry';
import { insetForBuilding } from '@/lib/explore/profile';
import { insetRing } from '@/lib/floor-bands';
import { addRoof, type MassingArrays } from '@/lib/explore/massing';
import type { Inside } from '@/lib/explore/walk';

/**
 * One walkable floor plate, entered from its band.
 *
 * The plan asks for exactly one, on a hero, and this is what it means: stand
 * on the 14th floor and look out of its window. Nothing more is claimed. There
 * is no core, no lift lobby, no partitioning — modelling interiors per space
 * by hand is a stated non-goal, and a floor plan invented for a space we hold
 * no drawing of would be the map telling a broker something it does not know.
 *
 * **It shares its maths with the band.** The elevation is
 * `(floor - 1) x floorHeight`, from `floorHeightFt`, which is precisely what
 * `computeBands` uses; the outline is the building's own cross-section at that
 * elevation, which is precisely what `bandRingAt` uses. That is not tidiness —
 * if the two ever parted company a broker would step onto the floor and find
 * the Goldenrod band at their ankles or over their head.
 */

/** How far in from the glass the plate stops. A structural bay, near enough. */
const PLATE_INSET = 0.985;

/** Storey height, so the ceiling is somewhere and not everywhere. */
const CEILING_CLEARANCE = 0.86;

export function floorPlateFor(
  frame: LocalFrame,
  building: BuildingWithSpaces,
  floorNumber: number,
): Inside | null {
  if (floorNumber < 1) return null;

  const { height: floorFt } = floorHeightFt(building);
  const floorM = (floorNumber - 1) * floorFt * FT_TO_M;

  // The building's own outline up there — surveyed where the city has it,
  // the profiled footprint where it does not. Same two sources, same order of
  // preference, as a band's collar.
  const section = surveyedSectionAt(building.bin, floorM);
  let ring: [number, number][] | null = section;
  if (!ring) {
    const footprint = buildingRing(building);
    if (!footprint) return null;
    ring = insetRing(footprint, insetForBuilding(building, floorM * (1 / FT_TO_M)));
  }

  const local = toCCW(openRing(ringToLocal(frame, insetRing(ring, PLATE_INSET))));
  if (local.length < 3) return null;

  return {
    buildingId: building.id,
    floorM,
    ring: local,
    // The storey the plate belongs to, so the ceiling can be put on it.
    ...({ floorHeightM: floorFt * FT_TO_M } as { floorHeightM: number }),
  } as Inside & { floorHeightM: number };
}

/**
 * The slab and the ceiling above it.
 *
 * Both are flat caps rather than solids. Nobody is ever underneath the slab or
 * above the ceiling — the building's own walls are around them and the walk
 * cannot leave the plate — so the faces that would be hidden cost nothing to
 * omit and would be a third of the geometry.
 */
export function plateMassing(inside: Inside): MassingArrays {
  const storeyM = (inside as Inside & { floorHeightM?: number }).floorHeightM ?? 3.8;

  const builder = {
    position: [] as number[],
    normal: [] as number[],
    along: [] as number[],
    up: [] as number[],
    wall: [] as number[],
    isWall: [] as number[],
    index: [] as number[],
  };

  // A hair above the band's own base, so the slab and the collar around the
  // outside of it are never coplanar.
  addRoof(builder, inside.ring, inside.floorM + 0.02);
  addRoof(builder, inside.ring, inside.floorM + storeyM * CEILING_CLEARANCE);

  return {
    position: new Float32Array(builder.position),
    normal: new Float32Array(builder.normal),
    along: new Float32Array(builder.along),
    up: new Float32Array(builder.up),
    wall: new Float32Array(builder.wall),
    isWall: new Float32Array(builder.isWall),
    index: new Uint32Array(builder.index),
    triangles: builder.index.length / 3,
  };
}
