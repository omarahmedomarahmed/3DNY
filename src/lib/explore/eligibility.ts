import type { BuildingWithSpaces } from '@/types';

/**
 * Which buildings get the full treatment.
 *
 * The plan states it as a rule rather than a list, and this is the one place
 * that rule is written down:
 *
 * > Any building we hold a record for gets the full treatment. Everything else
 * > is context massing.
 *
 * "Hold a record for" means the building is in our database at all — it
 * arrived through an availability sheet, a landlord feed, a tenant import, a
 * Salesforce sync or somebody typing an address into the map. Today that is 73
 * buildings and 312 spaces. It has to be true of building 400 with no code
 * change, which is why this is a predicate over the loaded set and not a
 * constant anywhere.
 *
 * A building with no availability today still qualifies. It is a tower we know
 * about, it will have space in it eventually, and a broker who typed its
 * address in should not find it rendered as anonymous grey massing.
 *
 * The only disqualifier is geometry: with no footprint and no coordinates
 * there is nothing to build, and a placeholder box at [0, 0] in the Atlantic
 * is worse than nothing.
 */
export function isDetailed(building: BuildingWithSpaces): boolean {
  const hasRing = Array.isArray(building.footprint) && building.footprint.length >= 4;
  const hasPoint = building.lon !== null && building.lat !== null;
  return hasRing || hasPoint;
}

/** The detailed set, in a stable order so the scene graph does not churn. */
export function detailedBuildings(buildings: BuildingWithSpaces[]): BuildingWithSpaces[] {
  return buildings.filter(isDetailed).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * How far out detail is worth drawing, in metres from the camera.
 *
 * Not a zoom threshold: Explore mode has a free camera that can be at street
 * level looking down an avenue, where zoom says "very close" and half the
 * frame is two kilometres away. Distance is the honest measure, and it is the
 * one the facade shader is already fading its window grid on.
 */
export const DETAIL_RADIUS_M = 900;

/** Beyond this, a building is a silhouette and nothing else. */
export const MASSING_RADIUS_M = 4_000;
