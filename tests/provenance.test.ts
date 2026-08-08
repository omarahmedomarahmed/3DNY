import { describe, expect, it } from 'vitest';
import type { Building, Landlord, Space } from '../src/types';
import {
  SOURCES,
  buildingSource,
  landlordSource,
  spaceOriginNote,
  spaceSource,
  spaceSourceSummary,
  streetSource,
  tenantSource,
  transitSource,
  type BuildingField,
  type SourceNote,
  type SpaceField,
} from '../src/lib/provenance';

/**
 * The resolver's job is to never be confidently wrong.
 *
 * A source note is read by someone who is about to say a number out loud in a
 * meeting, so the failures that matter are: crediting a sheet for a value a
 * person retyped, calling an estimate a record, and going silent on a source
 * this file has not seen before. Each of those gets a test.
 */

function makeSpace(over: Partial<Space> = {}): Space {
  return {
    id: 's1',
    building_id: 'b1',
    floor_number: 14,
    floor_label: '14',
    floor_portion: 'entire',
    sf: 12000,
    asking_rent_psf: 88,
    asking_rent_withheld: false,
    space_use: 'Office',
    lease_type: 'direct',
    sub_landlord: null,
    occupancy_raw: null,
    available_from: '2026-09-01',
    term_raw: null,
    term_expires: '2036-08-31',
    leasing_company: 'A Firm',
    agent_name: null,
    agent_email: null,
    agent_email_suspect: false,
    date_added: '2026-03-01',
    source_import_id: 'imp-1234-5678',
    import_filename: 'Midtown-2026-03.csv',
    import_uploaded_at: '2026-03-14T12:00:00Z',
    field_sources: {},
    notes: null,
    is_active: true,
    updated_at: '2026-03-14T12:00:00Z',
    ...over,
  };
}

function makeBuilding(over: Partial<Building> = {}): Building {
  return {
    id: 'b1',
    bin: '1024563',
    bbl: '1012960001',
    address_normalized: '540 MADISON AVE',
    address_display: '540 Madison Avenue',
    building_name: null,
    landlord_id: null,
    class: 'A',
    submarket: 'Plaza District',
    submarket_cluster: 'Midtown',
    num_floors: 41,
    height_roof_ft: 561,
    year_built: 1973,
    bldg_area_sf: 284000,
    lon: -73.9724,
    lat: 40.7602,
    footprint: null,
    match_confidence: 'exact',
    floor_height_override: null,
    notes: null,
    field_sources: {},
    updated_at: '2026-03-14T12:00:00Z',
    ...over,
  };
}

function makeLandlord(over: Partial<Landlord> = {}): Landlord {
  return {
    id: 'l1',
    name: 'Example Owner LLC',
    aliases: [],
    insights_md: null,
    amenities: [],
    portfolio_sf: null,
    buildings_owned: null,
    avg_asking_rent: null,
    notable_tenants: [],
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    owner_of_record: 'EXAMPLE OWNER LLC',
    source: 'city_record',
    needs_review: true,
    updated_at: '2026-03-14T12:00:00Z',
    ...over,
  };
}

/** Every note has to be renderable — a blank popover is worse than none. */
function assertUsable(note: SourceNote) {
  expect(note.label.trim().length).toBeGreaterThan(0);
  expect(note.detail.trim().length).toBeGreaterThan(0);
}

const SPACE_FIELDS: SpaceField[] = [
  'floor_label', 'floor_number', 'floor_portion', 'sf', 'asking_rent_psf',
  'space_use', 'lease_type', 'sub_landlord', 'available_from', 'term_expires',
  'leasing_company', 'date_added', 'notes', 'annual_rent', 'floor_band',
];

const BUILDING_FIELDS: BuildingField[] = [
  'address_display', 'building_name', 'class', 'submarket', 'submarket_cluster',
  'bin', 'bbl', 'num_floors', 'year_built', 'bldg_area_sf', 'height_roof_ft',
  'floor_height_override', 'landlord_name', 'notes', 'coordinates', 'footprint',
  'floor_height', 'availability_summary',
];

describe('every field has an answer', () => {
  it('resolves every space field to something renderable', () => {
    const space = makeSpace();
    for (const field of SPACE_FIELDS) assertUsable(spaceSource(space, field));
  });

  it('resolves every building field to something renderable', () => {
    const building = makeBuilding();
    for (const field of BUILDING_FIELDS) assertUsable(buildingSource(building, field));
  });

  it('resolves transit and street fields', () => {
    for (const field of ['name', 'routes', 'location', 'walk_time', 'walk_route'] as const) {
      assertUsable(transitSource(field));
    }
    assertUsable(streetSource());
  });

  it('gives every catalogued source a name and a sentence', () => {
    for (const [kind, dataset] of Object.entries(SOURCES)) {
      expect(dataset.name.trim().length, kind).toBeGreaterThan(0);
      expect(dataset.blurb.trim().length, kind).toBeGreaterThan(0);
    }
  });
});

describe('a hand-corrected field stops crediting the sheet', () => {
  it('reports the correction, not the import', () => {
    const space = makeSpace({
      field_sources: { asking_rent_psf: { kind: 'manual', at: '2026-08-01T09:00:00Z' } },
    });
    const note = spaceSource(space, 'asking_rent_psf');
    expect(note.kind).toBe('manual');
    expect(note.label).toContain('Aug 1, 2026');
    expect(note.detail).not.toContain('Midtown-2026-03.csv');
  });

  it('leaves the unstamped fields on the sheet', () => {
    const space = makeSpace({
      field_sources: { asking_rent_psf: { kind: 'manual', at: '2026-08-01T09:00:00Z' } },
    });
    const note = spaceSource(space, 'sf');
    expect(note.kind).toBe('sheet');
    expect(note.label).toContain('Midtown-2026-03.csv');
  });

  it('overrides a city field on a building too', () => {
    const building = makeBuilding({
      field_sources: { num_floors: { kind: 'manual', at: '2026-08-01T09:00:00Z' } },
    });
    expect(buildingSource(building, 'num_floors').kind).toBe('manual');
    expect(buildingSource(building, 'year_built').kind).toBe('pluto');
  });
});

describe('a source this file has never heard of still says something', () => {
  it('names the writer rather than falling back to the sheet', () => {
    const space = makeSpace({
      field_sources: {
        asking_rent_psf: { kind: 'hubspot', at: '2026-08-01T09:00:00Z', ref: 'DEAL-42' },
      },
    });
    const note = spaceSource(space, 'asking_rent_psf');
    expect(note.kind).toBe('unknown');
    expect(note.label).toContain('hubspot');
    expect(note.detail).toContain('DEAL-42');
  });

  it('handles the Salesforce kind the schema is shaped for', () => {
    const space = makeSpace({
      field_sources: { sf: { kind: 'salesforce', at: '2026-08-01T09:00:00Z', ref: '006xx' } },
    });
    const note = spaceSource(space, 'sf');
    expect(note.kind).toBe('salesforce');
    expect(note.label).toContain('Salesforce');
    expect(note.detail).toContain('006xx');
  });
});

describe('a space nobody imported reads as hand-entered', () => {
  it('does not invent an import', () => {
    const note = spaceOriginNote(
      makeSpace({ source_import_id: null, import_filename: null, import_uploaded_at: null }),
    );
    expect(note.kind).toBe('manual');
    expect(note.label).toContain('Entered here');
  });

  it('falls back to the import id when the filename did not come through', () => {
    const note = spaceOriginNote(makeSpace({ import_filename: null }));
    expect(note.kind).toBe('sheet');
    expect(note.label).toContain('imp-1234');
  });
});

describe('estimates admit to being estimates', () => {
  it('marks annual rent as calculated, not quoted', () => {
    const note = spaceSource(makeSpace(), 'annual_rent');
    expect(note.kind).toBe('derived');
    expect(note.approximate).toBe(true);
  });

  it('marks the floor band position as calculated', () => {
    expect(spaceSource(makeSpace(), 'floor_band').approximate).toBe(true);
  });

  it('marks derived floor height as calculated', () => {
    expect(buildingSource(makeBuilding(), 'floor_height').approximate).toBe(true);
  });

  it('marks the walk time as an estimate but the routed path as a real network', () => {
    expect(transitSource('walk_time').kind).toBe('derived');
    expect(transitSource('walk_route').kind).toBe('centerline');
  });

  it('does not mark a recorded city figure as approximate', () => {
    expect(buildingSource(makeBuilding(), 'year_built').approximate).toBeFalsy();
    expect(buildingSource(makeBuilding(), 'num_floors').approximate).toBeFalsy();
  });
});

describe('an unconfirmed address match taints what hangs off it', () => {
  it('warns on the identifiers and the city figures', () => {
    const building = makeBuilding({ match_confidence: 'fuzzy' });
    for (const field of ['bin', 'bbl', 'num_floors', 'height_roof_ft'] as BuildingField[]) {
      const note = buildingSource(building, field);
      expect(note.approximate, field).toBe(true);
      expect(note.detail, field).toContain('fuzzy');
    }
  });

  it('leaves the sheet fields alone — the sheet said what it said', () => {
    const building = makeBuilding({ match_confidence: 'fuzzy' });
    const note = buildingSource(building, 'address_display');
    expect(note.kind).toBe('sheet');
    expect(note.approximate).toBeFalsy();
  });
});

describe('the sheet and the city are not confused with each other', () => {
  it('credits the sheet for what only a broker would know', () => {
    const building = makeBuilding();
    for (const field of ['class', 'submarket', 'building_name'] as BuildingField[]) {
      expect(buildingSource(building, field).kind, field).toBe('sheet');
    }
  });

  it('credits the city for what only the city records', () => {
    const building = makeBuilding();
    expect(buildingSource(building, 'num_floors').kind).toBe('pluto');
    expect(buildingSource(building, 'height_roof_ft').kind).toBe('footprints');
    expect(buildingSource(building, 'bin').kind).toBe('geocode');
  });
});

describe('landlord panels do not pass hand-written notes off as records', () => {
  it('calls insights what they are', () => {
    const note = landlordSource(makeLandlord(), 'insights_md');
    expect(note.kind).toBe('manual');
  });

  it('flags an unconfirmed owner name', () => {
    const note = landlordSource(makeLandlord(), 'name');
    expect(note.kind).toBe('pluto');
    expect(note.approximate).toBe(true);
  });

  it('stops flagging once someone has confirmed it', () => {
    const note = landlordSource(makeLandlord({ needs_review: false }), 'name');
    expect(note.approximate).toBeFalsy();
  });

  it('treats a hand-created landlord as hand-created', () => {
    const note = landlordSource(makeLandlord({ source: 'manual' }), 'name');
    expect(note.kind).toBe('manual');
  });
});

describe('tenancies are never presented as public record', () => {
  it('says a hand-entered tenant was hand-entered', () => {
    const note = tenantSource('manual');
    expect(note.kind).toBe('manual');
    expect(note.detail).toContain('not public record');
  });

  it('credits a roster sheet without calling it a record', () => {
    const note = tenantSource('csv');
    expect(note.kind).toBe('sheet');
    expect(note.detail).toContain('not public record');
  });

  it('handles the CRM source the type already allows', () => {
    expect(tenantSource('salesforce').kind).toBe('salesforce');
  });

  it('never credits the city for a tenancy', () => {
    for (const source of ['manual', 'csv', 'salesforce', 'whatever']) {
      const note = tenantSource(source);
      expect(['pluto', 'footprints', 'geocode'], source).not.toContain(note.kind);
    }
  });
});

describe('landlord notes stay collapsible across a compare row', () => {
  // Compare shows one marker per row when every column gives the same answer.
  // Putting each landlord's own edit date in the LABEL would split one honest
  // "we wrote this" into three markers that say the same thing.
  it('gives the same label regardless of when the record was edited', () => {
    const a = landlordSource(makeLandlord({ updated_at: '2026-01-02T00:00:00Z' }), 'amenities');
    const b = landlordSource(makeLandlord({ updated_at: '2026-07-30T00:00:00Z' }), 'amenities');
    expect(a.label).toBe(b.label);
    expect(a.detail).not.toBe(b.detail);
  });

  it('still tells you when it was last edited', () => {
    const note = landlordSource(makeLandlord({ updated_at: '2026-07-30T00:00:00Z' }), 'amenities');
    expect(note.detail).toContain('Jul 30, 2026');
  });
});

describe('hand-kept transit stops say so', () => {
  it('does not claim the MTA publishes ferry landings', () => {
    expect(transitSource('name', 'ferry').kind).toBe('manual');
    expect(transitSource('name', 'path').kind).toBe('manual');
  });

  it('does credit the MTA for subway and bus', () => {
    expect(transitSource('name', 'subway').kind).toBe('mta');
    expect(transitSource('routes', 'bus').kind).toBe('mta');
  });
});

describe('the snapshot footnote carries what the icon would have', () => {
  it('names the sheet and the city datasets', () => {
    const lines = spaceSourceSummary(makeSpace(), makeBuilding());
    const text = lines.join(' ');
    expect(text).toContain('Midtown-2026-03.csv');
    expect(text).toContain('MapPLUTO');
    expect(text).toContain('BIN 1024563');
  });

  it('says which fields were corrected by hand', () => {
    const space = makeSpace({
      field_sources: { asking_rent_psf: { kind: 'manual', at: '2026-08-01T09:00:00Z' } },
    });
    expect(spaceSourceSummary(space, makeBuilding()).join(' ')).toContain('asking rent psf');
  });

  it('warns about an unconfirmed match', () => {
    const text = spaceSourceSummary(
      makeSpace(),
      makeBuilding({ match_confidence: 'unmatched' }),
    ).join(' ');
    expect(text).toContain('unmatched');
  });
});
