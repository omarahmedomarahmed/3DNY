/**
 * Where MapLibre's camera actually is.
 *
 * Explore mode needs the eye position in metres every frame: glass reflects
 * the sky from it, distance haze is measured from it, and the walking capsule
 * IS it. MapLibre computes the same thing internally and exposes it only on
 * `map.transform`, which is not part of the published type surface and has
 * moved between versions — this project has already been bitten once by
 * building on an internal that then changed shape.
 *
 * So it is derived here from public accessors alone, using MapLibre's own
 * camera model:
 *
 *   - a fixed vertical field of view of 36.87°
 *   - the camera sits `0.5 · height / tan(fov/2)` pixels from the point at the
 *     centre of the screen
 *   - pitch tips that distance between altitude and ground offset
 *   - bearing rotates the ground offset, and the camera sits *behind* the
 *     centre, so the offset runs opposite to the direction that is up on
 *     screen
 *
 * Pure, so it can be checked against known cameras in a unit test rather than
 * eyeballed in a browser.
 */

/** MapLibre's vertical field of view. Not configurable, and not a guess. */
export const MAPLIBRE_FOV = 0.6435011087932844;

/** Metres covered by one screen pixel at a zoom and latitude. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

export interface CameraView {
  /** [lon, lat] at the centre of the screen. */
  center: [number, number];
  zoom: number;
  /** Degrees from straight down. 0 is a plan view. */
  pitch: number;
  /** Degrees clockwise from north, of the direction that is up on screen. */
  bearing: number;
  /** Canvas height in CSS pixels. */
  height: number;
}

export interface CameraPosition {
  /** Metres east of the view centre. */
  east: number;
  /** Metres north of the view centre. */
  north: number;
  /** Metres above the ground plane. */
  altitude: number;
  /** Metres from the eye to the point at the centre of the screen. */
  distance: number;
}

/**
 * The eye, relative to the point at the centre of the screen.
 *
 * Relative rather than absolute on purpose: the caller already knows where the
 * centre is in whatever frame it cares about, and returning an offset keeps
 * this function free of any projection.
 */
export function cameraOffset(view: CameraView): CameraPosition {
  const distancePx = (0.5 * view.height) / Math.tan(MAPLIBRE_FOV / 2);
  const distance = distancePx * metersPerPixel(view.center[1], view.zoom);

  const pitch = (view.pitch * Math.PI) / 180;
  const bearing = (view.bearing * Math.PI) / 180;

  const ground = distance * Math.sin(pitch);
  return {
    // Behind the centre: opposite the direction that is up on screen.
    east: -ground * Math.sin(bearing),
    north: -ground * Math.cos(bearing),
    altitude: distance * Math.cos(pitch),
    distance,
  };
}

/**
 * The inverse: the camera state that puts the eye at a given place looking in
 * a given direction.
 *
 * This is what makes a first-person walk possible without leaving MapLibre's
 * camera behind. Driving `center`/`zoom`/`pitch`/`bearing` from an eye
 * position means deck.gl, the basemap and the three.js scene all follow one
 * camera — so a Goldenrod band cannot drift away from the window it is on
 * while you walk toward it.
 */
export function viewForEye(opts: {
  /** Metres east and north of a reference point, and metres up. */
  eye: [number, number, number];
  /** Degrees clockwise from north that the walker is facing. */
  bearing: number;
  /** Degrees from straight down. 90 is level with the horizon. */
  pitch: number;
  height: number;
  lat: number;
}): { centerOffset: [number, number]; zoom: number } {
  const pitch = (opts.pitch * Math.PI) / 180;
  const bearing = (opts.bearing * Math.PI) / 180;

  // Altitude and pitch fix the distance to whatever the camera is looking at.
  // A camera looking at the horizon has no such point, so the pitch is held
  // just under level — the same reason MapLibre itself stops at 85°.
  const cosPitch = Math.max(Math.cos(pitch), 0.02);
  const distance = opts.eye[2] / cosPitch;
  const ground = distance * Math.sin(pitch);

  const distancePx = (0.5 * opts.height) / Math.tan(MAPLIBRE_FOV / 2);
  const mpp = distance / distancePx;
  const zoom = Math.log2((40_075_016.686 * Math.cos((opts.lat * Math.PI) / 180)) / (512 * mpp));

  return {
    centerOffset: [
      opts.eye[0] + ground * Math.sin(bearing),
      opts.eye[1] + ground * Math.cos(bearing),
    ],
    zoom,
  };
}
