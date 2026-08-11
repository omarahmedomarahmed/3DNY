import { describe, it, expect } from 'vitest';
import {
  binOf,
  surfacesOf,
  toMassing,
  envelopeOf,
  pickTiles,
  splitMembers,
  wgs84ToStatePlane,
  statePlaneToWgs84,
  US_SURVEY_FOOT,
  type Tile,
} from '@/lib/citygml';

/** A cut-down `<bldg:Building>` block in the shape the city actually ships. */
function member(bin: string, extra = '') {
  return `
<bldg:Building gml:id="gml_TEST">
<gml:name>Bldg_12210000161</gml:name>
<gen:stringAttribute name="BIN"><gen:value>${bin}</gen:value></gen:stringAttribute>
<gen:stringAttribute name="DOITT_ID"><gen:value>110442</gen:value></gen:stringAttribute>
<bldg:boundedBy>
<bldg:GroundSurface gml:id="g1">
<bldg:lod2MultiSurface><gml:MultiSurface srsName="EPSG:2263" srsDimension="3">
<gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>
988000 219000 20  988100 219000 20  988100 219080 20  988000 219080 20
</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>
</gml:MultiSurface></bldg:lod2MultiSurface>
</bldg:GroundSurface>
</bldg:boundedBy>
<bldg:boundedBy>
<bldg:RoofSurface gml:id="r1">
<bldg:lod2MultiSurface><gml:MultiSurface srsName="EPSG:2263" srsDimension="3">
<gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>
988000 219000 120  988100 219000 120  988100 219080 120  988000 219080 120
</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>
</gml:MultiSurface></bldg:lod2MultiSurface>
</bldg:RoofSurface>
</bldg:boundedBy>
${extra}
</bldg:Building>`;
}

const WALL = `
<bldg:boundedBy>
<bldg:WallSurface gml:id="w1">
<bldg:lod2MultiSurface><gml:MultiSurface srsName="EPSG:2263" srsDimension="3">
<gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>
988000 219000 20  988100 219000 20  988100 219000 120  988000 219000 120
</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>
</gml:MultiSurface></bldg:lod2MultiSurface>
</bldg:WallSurface>
</bldg:boundedBy>`;

describe('EPSG:2263', () => {
  // Verified against the published state plane coordinates of the delivery
  // areas: the Empire State Building sits inside DA12's envelope, which spans
  // X 977,500–1,002,500 and Y 192,500–220,000 feet.
  it('places the Empire State Building where the city says it is', () => {
    const [x, y] = wgs84ToStatePlane(-73.985664, 40.748440);
    expect(x).toBeGreaterThan(977_500);
    expect(x).toBeLessThan(1_002_500);
    expect(y).toBeGreaterThan(192_500);
    expect(y).toBeLessThan(220_000);
    expect(x).toBeCloseTo(988_222, -1);
    expect(y).toBeCloseTo(211_954, -1);
  });

  it('round-trips to within a millimetre across Manhattan', () => {
    const places: [number, number][] = [
      [-74.014, 40.702],   // the Battery
      [-73.985, 40.748],   // midtown
      [-73.945, 40.807],   // Harlem
      [-73.921, 40.878],   // Inwood
    ];
    for (const [lon, lat] of places) {
      const [x, y] = wgs84ToStatePlane(lon, lat);
      const [lon2, lat2] = statePlaneToWgs84(x, y);
      expect(lon2).toBeCloseTo(lon, 9);
      expect(lat2).toBeCloseTo(lat, 9);
    }
  });

  it('uses the US survey foot, not the international foot', () => {
    // They differ by two parts per million — about 2 m across Manhattan, which
    // is a whole building's width of error if the wrong one is used.
    expect(US_SURVEY_FOOT).toBeCloseTo(0.30480060960121924, 15);
    expect(US_SURVEY_FOOT).not.toBeCloseTo(0.3048, 9);
  });
});

describe('parsing a building block', () => {
  it('reads the BIN', () => {
    expect(binOf(member('1015862'))).toBe('1015862');
    expect(binOf('<bldg:Building></bldg:Building>')).toBeNull();
  });

  it('classifies roof, wall and ground surfaces', () => {
    const surfaces = surfacesOf(member('1015862', WALL));
    expect(surfaces.map((s) => s.k).sort()).toEqual(['G', 'R', 'W']);
    expect(surfaces.every((s) => s.pts.length === 4)).toBe(true);
  });

  it('drops rings with fewer than three points rather than emitting slivers', () => {
    const degenerate = member('1', `
<bldg:boundedBy><bldg:WallSurface><bldg:lod2MultiSurface><gml:MultiSurface>
<gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>
988000 219000 20  988100 219000 20
</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>
</gml:MultiSurface></bldg:lod2MultiSurface></bldg:WallSurface></bldg:boundedBy>`);
    expect(surfacesOf(degenerate).filter((s) => s.k === 'W')).toHaveLength(0);
  });
});

describe('toMassing', () => {
  const massing = toMassing(surfacesOf(member('1015862', WALL)))!;

  it('recentres on the bounding box and converts feet to metres', () => {
    // The box spans 100 x 80 ft, so local coordinates run +/- 50 x +/- 40 ft.
    const xs = massing.surfaces.flatMap((s) => s.p.filter((_, i) => i % 3 === 0));
    expect(Math.max(...xs)).toBeCloseTo(50 * US_SURVEY_FOOT, 1);
    expect(Math.min(...xs)).toBeCloseTo(-50 * US_SURVEY_FOOT, 1);
  });

  it('measures height from the ground surface, not the vertical datum', () => {
    // Ground sits at 20 ft on the datum; the roof at 120. The building is 100
    // ft tall, and would be 120 if the datum leaked through.
    expect(massing.topM).toBeCloseTo(100 * US_SURVEY_FOOT, 1);
  });

  it('anchors the building back in WGS84', () => {
    const [lon, lat] = massing.anchor;
    expect(lon).toBeCloseTo(-73.98, 1);
    expect(lat).toBeCloseTo(40.75, 1);
  });

  it('returns null for a building with no surfaces at all', () => {
    expect(toMassing([])).toBeNull();
  });
});

describe('tile selection', () => {
  const tiles: Tile[] = [
    { name: 'DA12', entry: 'x/DA12.gml', bbox: [977_500, 192_500, 1_002_500, 220_000] },
    { name: 'DA13', entry: 'x/DA13.gml', bbox: [982_500, 220_000, 1_010_000, 260_000] },
    { name: 'DA17', entry: 'x/DA17.gml', bbox: [910_000, 117_500, 972_500, 155_000] },
  ];

  it('picks only the tiles that could hold one of our buildings', () => {
    const picked = pickTiles(tiles, [[-73.985664, 40.748440]]);
    expect(picked.map((t) => t.name)).toEqual(['DA12']);
  });

  it('picks every overlapping tile, because delivery areas overlap', () => {
    const picked = pickTiles(tiles, [[-73.985664, 40.748440], [-73.945, 40.807]]);
    expect(picked.map((t) => t.name).sort()).toEqual(['DA12', 'DA13']);
  });

  it('picks nothing when no building falls inside — never the whole city', () => {
    expect(pickTiles(tiles, [[-118.24, 34.05]])).toEqual([]);
  });

  it('reads the envelope a tile opens with', () => {
    const head = `<gml:boundedBy><gml:Envelope srsName="EPSG:2263" srsDimension="3">
      <gml:lowerCorner>978979.24 194479.07 -39.01</gml:lowerCorner>
      <gml:upperCorner>1002759.79 220148.66 1797.10</gml:upperCorner>
      </gml:Envelope></gml:boundedBy>`;
    expect(envelopeOf(head)).toEqual([978979.24, 194479.07, 1002759.79, 220148.66]);
    expect(envelopeOf('<gml:boundedBy/>')).toBeNull();
  });

  it('keeps an envelope whose elevation is NaN, as two real tiles ship', () => {
    // DA2 and DA4 both carry NaN for a corner's z. Only x and y are used, so
    // rejecting these would drop two tiles of the city for no reason.
    const head = `<gml:Envelope>
      <gml:lowerCorner>999999.99 149028.01 NaN</gml:lowerCorner>
      <gml:upperCorner>1037376.00 171832.55 NaN</gml:upperCorner></gml:Envelope>`;
    expect(envelopeOf(head)).toEqual([999999.99, 149028.01, 1037376.00, 171832.55]);
  });

  it('still rejects an envelope with an unreadable easting', () => {
    const head = `<gml:Envelope>
      <gml:lowerCorner>oops 149028.01 0</gml:lowerCorner>
      <gml:upperCorner>1037376.00 171832.55 0</gml:upperCorner></gml:Envelope>`;
    expect(envelopeOf(head)).toBeNull();
  });
});

describe('splitMembers', () => {
  it('holds back an unterminated tail instead of losing the building', () => {
    const whole = `<core:cityObjectMember>${member('1')}</core:cityObjectMember>`;
    const cut = Math.floor(whole.length * 0.6);

    const first = splitMembers(whole.slice(0, cut));
    expect(first.members).toHaveLength(0);

    const second = splitMembers(first.rest + whole.slice(cut));
    expect(second.members).toHaveLength(1);
    expect(binOf(second.members[0])).toBe('1');
  });

  it('ignores members that are not buildings', () => {
    const notABuilding = '<core:cityObjectMember><dem:ReliefFeature/></core:cityObjectMember>';
    expect(splitMembers(notABuilding).members).toHaveLength(0);
  });

  it('accepts the bare tag DA2 and DA4 use, not just the prefixed one', () => {
    // Matching only `</core:cityObjectMember>` against those tiles would buffer
    // the whole 286 MB file into one string and find nothing at all.
    const bare = `<cityObjectMember>${member('2001')}</cityObjectMember>`;
    const prefixed = `<core:cityObjectMember>${member('1002')}</core:cityObjectMember>`;
    const both = splitMembers(bare + prefixed);
    expect(both.members.map(binOf)).toEqual(['2001', '1002']);
  });
});
