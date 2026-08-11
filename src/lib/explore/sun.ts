/**
 * Where the sun actually is, for a timestamp and a place.
 *
 * deck.gl's `_SunLight` already does this for the flat map, but it does it
 * inside its own shader module and offers no way to ask. Explore mode needs
 * the same answer in the scene's own frame, and the two must agree: a
 * three.js facade lit from the south-west beside a deck.gl band lit from the
 * south-east is the sort of mismatch nobody can name and everybody notices.
 *
 * So the position is computed here, from the same timestamps the atmosphere
 * presets already carry, and both renderers are handed it.
 *
 * The algorithm is the low-precision solar position from the Astronomical
 * Almanac — good to about a hundredth of a degree, which is four orders of
 * magnitude better than anything a shadow on a facade can show.
 */

const RAD = Math.PI / 180;

export interface SunPosition {
  /** Radians above the horizon. Negative when the sun is down. */
  altitude: number;
  /** Radians clockwise from north. */
  azimuth: number;
}

/** Days since J2000.0, from a Unix millisecond timestamp. */
export function julianDays(timestampMs: number): number {
  return timestampMs / 86_400_000 - 10_957.5;
}

export function sunPosition(timestampMs: number, lon: number, lat: number): SunPosition {
  const n = julianDays(timestampMs);

  // Mean longitude and mean anomaly, both in degrees, wrapped later.
  const L = 280.46 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * RAD;

  // Ecliptic longitude: the mean longitude plus the equation of centre.
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  // Obliquity of the ecliptic, falling by about half an arcsecond a year.
  const epsilon = (23.439 - 0.0000004 * n) * RAD;

  const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const rightAscension = Math.atan2(
    Math.cos(epsilon) * Math.sin(lambda),
    Math.cos(lambda),
  );

  // Greenwich mean sidereal time in degrees, then local hour angle.
  const gmst = 18.697374558 + 24.06570982441908 * n;
  const lst = ((gmst * 15 + lon) % 360) * RAD;
  const hourAngle = lst - rightAscension;

  const latR = lat * RAD;
  const altitude = Math.asin(
    Math.sin(latR) * Math.sin(declination) +
      Math.cos(latR) * Math.cos(declination) * Math.cos(hourAngle),
  );
  const azimuth = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(declination) * Math.cos(latR) - Math.sin(latR) * Math.cos(hourAngle),
  );

  return { altitude, azimuth };
}

/**
 * The direction light travels, as a unit vector in the scene frame
 * (+X east, +Y north, +Z up).
 *
 * This points FROM the sun TOWARD the ground, which is the convention
 * three.js's directional light and every lighting term here uses. A sun below
 * the horizon is clamped to just above it: at night the city is lit by
 * something, and a light vector pointing up out of the pavement lights only
 * the undersides of things.
 */
export function sunDirection(
  timestampMs: number,
  lon: number,
  lat: number,
): [number, number, number] {
  const { altitude, azimuth } = sunPosition(timestampMs, lon, lat);
  const alt = Math.max(altitude, 6 * RAD);
  const cos = Math.cos(alt);
  // Azimuth is clockwise from north: north is +Y, east is +X.
  const toSun: [number, number, number] = [
    cos * Math.sin(azimuth),
    cos * Math.cos(azimuth),
    Math.sin(alt),
  ];
  return [-toSun[0], -toSun[1], -toSun[2]];
}
