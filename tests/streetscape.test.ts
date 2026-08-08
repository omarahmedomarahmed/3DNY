import { describe, expect, it } from 'vitest';
import {
  clampRoadWidth,
  layoutStreetNames,
  parkTier,
  polylineMeters,
  polylineMidpoint,
  roadTier,
  segmentAngle,
  type RoadSegment,
} from '../src/lib/streetscape';

/** ~40.75°N, where one degree of longitude is ~84.3km. */
const LAT = 40.75;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);

const north = (m: number) => m / M_PER_DEG_LAT;
const east = (m: number) => m / M_PER_DEG_LON;

function eastWest(meters: number, lat = LAT): [number, number][] {
  return [
    [-73.99, lat],
    [-73.99 + meters / M_PER_DEG_LON, lat],
  ];
}

describe('roadTier', () => {
  it('classes highways, bridges and ramps as tier 0 regardless of width', () => {
    expect(roadTier('2', 30)).toBe(0);
    expect(roadTier('3', 100)).toBe(0);
    expect(roadTier('9', 20)).toBe(0);
  });

  it('separates avenues, streets and alleys by measured width', () => {
    expect(roadTier('1', 100)).toBe(1); // Park Avenue
    expect(roadTier('1', 60)).toBe(1); // a wide two-way
    expect(roadTier('1', 34)).toBe(2); // a Manhattan side street
    expect(roadTier('1', 22)).toBe(3); // an alley
  });
});

describe('clampRoadWidth', () => {
  it('substitutes a plausible street for missing or absurd survey values', () => {
    expect(clampRoadWidth(null)).toBe(30);
    expect(clampRoadWidth(0)).toBe(30);
    expect(clampRoadWidth(-5)).toBe(30);
    expect(clampRoadWidth(4000)).toBe(120);
    expect(clampRoadWidth(3)).toBe(16);
    expect(clampRoadWidth(60)).toBe(60);
  });
});

describe('parkTier', () => {
  it('treats real parkland as greensward', () => {
    expect(parkTier('Flagship Park')).toBe(0); // Central Park
    expect(parkTier('Neighborhood Park')).toBe(0);
    expect(parkTier('Community Park')).toBe(0);
    expect(parkTier('Nature Area')).toBe(0);
  });

  it('treats triangles, plazas and institutions as hardscape', () => {
    expect(parkTier('Triangle/Plaza')).toBe(1); // Herald Square
    expect(parkTier('Buildings/Institutions')).toBe(1);
  });

  it('separates active recreation', () => {
    expect(parkTier('Playground')).toBe(2);
    expect(parkTier('Recreational Field/Courts')).toBe(2);
  });

  it('defaults an unknown category to greensward, never to concrete', () => {
    // Drawing lawn where there is concrete is a far smaller error than
    // drawing concrete over Central Park.
    expect(parkTier('Something NYC Added Last Week')).toBe(0);
    expect(parkTier('')).toBe(0);
  });
});

describe('segmentAngle', () => {
  it('is 0 for an east-west street and 90 for an avenue running north', () => {
    expect(segmentAngle([-73.99, 40.75], [-73.98, 40.75])).toBeCloseTo(0, 5);
    expect(segmentAngle([-73.99, 40.75], [-73.99, 40.76])).toBeCloseTo(90, 5);
  });

  it('normalises into (-90, 90] so painted text is never upside down', () => {
    // The same street traversed west and east must paint at the same angle.
    const eastward = segmentAngle([-73.99, 40.75], [-73.98, 40.751]);
    const westward = segmentAngle([-73.98, 40.751], [-73.99, 40.75]);
    expect(eastward).toBeCloseTo(westward, 5);
    expect(eastward).toBeGreaterThan(-90);
    expect(eastward).toBeLessThanOrEqual(90);
  });

  it('corrects longitude for latitude, so a true diagonal paints at 45°', () => {
    // Equal metres east and north: dLon must be larger than dLat in degrees.
    const dLatDeg = 100 / M_PER_DEG_LAT;
    const dLonDeg = 100 / M_PER_DEG_LON;
    const angle = segmentAngle([-73.99, LAT], [-73.99 + dLonDeg, LAT + dLatDeg]);
    expect(angle).toBeCloseTo(45, 0);
  });
});

describe('polylineMidpoint', () => {
  it('finds the halfway point by arc length, not by vertex index', () => {
    // Three vertices, but the first leg is 900m and the second 100m: the
    // midpoint must sit inside the first leg, not at the middle vertex.
    const line: [number, number][] = [
      [-73.99, LAT],
      [-73.99 + 900 / M_PER_DEG_LON, LAT],
      [-73.99 + 1000 / M_PER_DEG_LON, LAT],
    ];
    const { point } = polylineMidpoint(line);
    const walked = polylineMeters([line[0], point]);
    expect(walked).toBeCloseTo(500, -1);
  });

  it('reports the direction of the segment the midpoint falls on', () => {
    const { angle } = polylineMidpoint(eastWest(200));
    expect(angle).toBeCloseTo(0, 5);
  });
});

function seg(
  name: string | null,
  tier: 0 | 1 | 2 | 3,
  line: [number, number][],
): RoadSegment {
  return { p: line, w: 60, t: tier, n: name };
}

describe('layoutStreetNames', () => {
  it('drops unnamed and too-short segments', () => {
    const labels = layoutStreetNames([
      seg(null, 1, eastWest(500)),
      seg('SHORT ST', 2, eastWest(20)),
    ]);
    expect(labels).toHaveLength(0);
  });

  it('paints one name per street per stretch, not one per block segment', () => {
    // Five consecutive 100m blocks of the same street.
    const blocks: RoadSegment[] = [];
    for (let i = 0; i < 5; i++) {
      const start = -73.99 + (i * 100) / M_PER_DEG_LON;
      blocks.push(
        seg('W 42 ST', 2, [
          [start, LAT],
          [start + 100 / M_PER_DEG_LON, LAT],
        ]),
      );
    }
    const labels = layoutStreetNames(blocks, { repeatMeters: 420 });
    expect(labels.length).toBe(1);
  });

  it('repeats a long street name at intervals', () => {
    const blocks: RoadSegment[] = [];
    for (let i = 0; i < 5; i++) {
      const start = -73.99 + (i * 500) / M_PER_DEG_LON;
      blocks.push(
        seg('BROADWAY', 1, [
          [start, LAT],
          [start + 400 / M_PER_DEG_LON, LAT],
        ]),
      );
    }
    const labels = layoutStreetNames(blocks, { repeatMeters: 420 });
    expect(labels.length).toBeGreaterThan(1);
  });

  it('gives the avenue priority over the side street at an intersection', () => {
    const avenue = seg('5 AVE', 1, [
      [-73.99, LAT - 200 / M_PER_DEG_LAT],
      [-73.99, LAT + 200 / M_PER_DEG_LAT],
    ]);
    const street = seg('W 40 ST', 2, [
      [-73.99 - 60 / M_PER_DEG_LON, LAT],
      [-73.99 + 60 / M_PER_DEG_LON, LAT],
    ]);
    const labels = layoutStreetNames([street, avenue], { clearMeters: 80 });
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe('5 AVE');
  });

  it('yields a contested spot to the avenue, not to the highway ramp', () => {
    // Sorting by tier number would put tier 0 first and spend the label budget
    // on ramp names. A broker names avenues; nobody names an on-ramp.
    const ramp = seg('FDR DRIVE SB ENTRANCE E 34 ST', 0, [
      [-73.99, LAT - 300 / M_PER_DEG_LAT],
      [-73.99, LAT + 300 / M_PER_DEG_LAT],
    ]);
    const avenue = seg('PARK AVE', 1, [
      [-73.99 - 60 / M_PER_DEG_LON, LAT],
      [-73.99 + 60 / M_PER_DEG_LON, LAT],
    ]);
    const labels = layoutStreetNames([ramp, avenue], { clearMeters: 80 });
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe('PARK AVE');
  });

  it('keeps names that are comfortably apart', () => {
    const labels = layoutStreetNames([
      seg('5 AVE', 1, eastWest(300)),
      seg('W 40 ST', 2, eastWest(300, LAT + 900 / M_PER_DEG_LAT)),
    ]);
    expect(labels).toHaveLength(2);
  });
});

describe('street names follow the camera', () => {
  /**
   * The failure this fixes: zoomed in at a corner, the midpoint of the street
   * you are standing on is two blocks away and off screen, so the street has
   * no name until you pan along it to find one.
   */
  const long: RoadSegment[] = [
    seg('W 42 ST', 2, [
      [-73.99, LAT],
      [-73.99 + east(2000), LAT],
    ]),
  ];

  it('puts the name next to where the camera is looking', () => {
    const nearWestEnd = layoutStreetNames(long, { focus: [-73.99 + east(120), LAT] });
    expect(nearWestEnd).toHaveLength(1);
    const from = polylineMeters([[-73.99, LAT], nearWestEnd[0].position]);
    expect(from).toBeCloseTo(120, -1);
  });

  it('moves the name when the camera moves', () => {
    const west = layoutStreetNames(long, { focus: [-73.99 + east(120), LAT] })[0];
    const east2 = layoutStreetNames(long, { focus: [-73.99 + east(1800), LAT] })[0];
    const apart = polylineMeters([west.position, east2.position]);
    expect(apart).toBeGreaterThan(1500);
  });

  it('still lies along the street, not across it', () => {
    const label = layoutStreetNames(long, { focus: [-73.99 + east(600), LAT + north(40)] })[0];
    expect(label.angle).toBeCloseTo(0, 5);
  });

  it('falls back to the midpoint when there is no camera', () => {
    const label = layoutStreetNames(long)[0];
    const from = polylineMeters([[-73.99, LAT], label.position]);
    expect(from).toBeCloseTo(1000, -2);
  });

  it('prefers the nearer street when two compete for the same spot', () => {
    // Both avenues, so tier cannot decide it; the one under the camera wins.
    const near = seg('NEAR AVE', 1, [
      [-73.99, LAT],
      [-73.99 + east(300), LAT],
    ]);
    const far = seg('FAR AVE', 1, [
      [-73.99, LAT + north(30)],
      [-73.99 + east(300), LAT + north(30)],
    ]);
    const labels = layoutStreetNames([far, near], {
      focus: [-73.99 + east(150), LAT],
      clearMeters: 200,
    });
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe('NEAR AVE');
  });
});
