import { describe, expect, it } from 'vitest';
import { computeBands, mergeRuns, spaceClaims, tenantClaims } from '../src/lib/floor-bands';
import { OCCUPANCY_COLORS, occupancyColors } from '../src/components/map/colors';
import { BRAND, rgba } from '../src/lib/brand';
import { applyFilters } from '../src/lib/filters';
import { EMPTY_FILTERS } from '../src/types';
import type { Building, BuildingWithSpaces, Space, Tenant } from '../src/types';

/**
 * Three kinds of band now share one facade, and the risk they introduce is the
 * same risk every addition to this map has: that the new thing out-shouts
 * availability. A tower has one availability and forty tenants, so the tests
 * here are as much about restraint as correctness.
 */

const BUILDING: Building = {
  id: 'b1',
  bin: '1', bbl: '1',
  address_normalized: 'X', address_display: 'X',
  building_name: null, landlord_id: null,
  class: 'A', submarket: null, submarket_cluster: null,
  num_floors: 40, height_roof_ft: 500, year_built: 1960, bldg_area_sf: null,
  lon: -73.97, lat: 40.75,
  footprint: [[-73.97, 40.75], [-73.969, 40.75], [-73.969, 40.751], [-73.97, 40.751], [-73.97, 40.75]],
  match_confidence: 'exact', floor_height_override: null, notes: null,
  updated_at: '2026-01-01T00:00:00Z',
};

function tenant(over: Partial<Tenant> = {}): Tenant {
  return {
    id: 't1', building_id: 'b1', company_name: 'Example Co',
    floors: '7-14', floor_numbers: [7, 8, 9, 10, 11, 12, 13, 14],
    suite: null, sf: null, lease_start: null, lease_expiration: null,
    industry: null, notes: null, relationship: 'occupier', source: 'csv',
    salesforce_id: null, salesforce_url: null, source_import_id: null,
    last_synced_at: null, updated_at: '2026-01-01T00:00:00Z',
    lease_term_months: null, rent_psf: null, deal_stage: null,
    ...over,
  };
}

function space(over: Partial<Space> = {}): Space {
  return {
    id: 's1', building_id: 'b1', floor_number: 14, floor_label: '14',
    floor_portion: 'entire', sf: 10000, asking_rent_psf: 88,
    asking_rent_withheld: false, space_use: null, lease_type: null,
    sub_landlord: null, occupancy_raw: null, available_from: null,
    term_raw: null, term_expires: null, leasing_company: null,
    agent_name: null, agent_email: null, agent_email_suspect: false,
    date_added: null, source_import_id: null, notes: null,
    is_active: true, updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('a block tenancy is one band, not eight', () => {
  it('merges a consecutive run', () => {
    const claims = tenantClaims([tenant()]);
    expect(claims).toHaveLength(1);
    expect(claims[0].floorNumber).toBe(7);
    expect(claims[0].floors).toBe(8);
  });

  it('keeps a gap in the run as two bands', () => {
    // 7-9 and 12 is two tenancies' worth of geometry for one company, and
    // drawing 10 and 11 as occupied would be inventing floors.
    const claims = tenantClaims([tenant({ floor_numbers: [7, 8, 9, 12] })]);
    expect(claims.map((c) => [c.floorNumber, c.floors])).toEqual([[7, 3], [12, 1]]);
  });

  it('never merges across two different companies on adjacent floors', () => {
    const claims = mergeRuns([
      { recordId: 'a', kind: 'occupied', floorNumber: 7, floors: 1, portion: 'entire', label: 'A' },
      { recordId: 'b', kind: 'occupied', floorNumber: 8, floors: 1, portion: 'entire', label: 'B' },
    ]);
    expect(claims).toHaveLength(2);
  });

  it('spans the right height once it becomes geometry', () => {
    const [band] = computeBands(BUILDING, tenantClaims([tenant()]));
    const floorHeight = 500 / 40;
    expect(band.baseFt).toBeCloseTo(6 * floorHeight, 5);
    expect(band.topFt - band.baseFt).toBeCloseTo(8 * floorHeight, 5);
    expect(band.floors).toBe(8);
  });
});

describe('what gets drawn, and what deliberately does not', () => {
  it('draws nothing for a tenancy with no readable floor', () => {
    // Ground-floor retail. The row exists and shows in the tenant table; it is
    // simply not drawn on a floor nobody stated.
    expect(tenantClaims([tenant({ floors: 'Ground', floor_numbers: [] })])).toEqual([]);
  });

  it('sorts a client into its own kind and everyone else into occupied', () => {
    expect(tenantClaims([tenant({ relationship: 'client' })])[0].kind).toBe('client');
    expect(tenantClaims([tenant({ relationship: 'prospect' })])[0].kind).toBe('occupied');
    expect(tenantClaims([tenant({ relationship: 'occupier' })])[0].kind).toBe('occupied');
  });

  it('treats a suite as a partial floor and a whole floor as entire', () => {
    expect(tenantClaims([tenant({ suite: '402' })])[0].portion).toBe('partial');
    expect(tenantClaims([tenant()])[0].portion).toBe('entire');
  });

  it('carries the company name so a band can say whose it is', () => {
    expect(tenantClaims([tenant()])[0].label).toBe('Example Co');
    expect(spaceClaims([space()])[0].label).toBeNull();
  });

  it('leaves an inactive space out', () => {
    expect(spaceClaims([space({ is_active: false })])).toEqual([]);
  });
});

describe('a tenant name finds its building', () => {
  /**
   * "Where is Kestrel Analytics" is asked out loud in a meeting, and a tenant
   * name is also how a broker locates a building they only know by its anchor.
   * Nobody remembers 100 Park Avenue; everybody remembers who is in it.
   */
  const withTenants: BuildingWithSpaces = {
    ...BUILDING,
    spaces: [space()],
    tenants: [tenant({ company_name: 'Kestrel Analytics', industry: 'Data & Analytics' })],
    minRent: 88, maxRent: 88, totalAvailableSf: 10000, spaceCount: 1,
  };
  const without: BuildingWithSpaces = {
    ...BUILDING, id: 'b2', address_display: 'Elsewhere',
    spaces: [space({ id: 's2', building_id: 'b2' })], tenants: [],
    minRent: 88, maxRent: 88, totalAvailableSf: 10000, spaceCount: 1,
  };

  const search = (q: string) =>
    applyFilters([withTenants, without], { ...EMPTY_FILTERS, search: q });

  it('matches on the company', () => {
    expect(search('kestrel').map((b) => b.id)).toEqual(['b1']);
  });

  it('matches on the industry', () => {
    expect(search('analytics').map((b) => b.id)).toEqual(['b1']);
  });

  it('still matches on everything it did before', () => {
    expect(search('elsewhere').map((b) => b.id)).toEqual(['b2']);
  });

  it('excludes a building whose tenants do not match', () => {
    expect(search('nobody here')).toEqual([]);
  });
});

describe('availability stays the loudest thing on the tower', () => {
  it('is the most opaque of the three', () => {
    const alpha = (k: string) => OCCUPANCY_COLORS[k].entire[3];
    expect(alpha('available')).toBeGreaterThan(alpha('client'));
    expect(alpha('client')).toBeGreaterThan(alpha('occupied'));
  });

  it('is the only Goldenrod one', () => {
    const gold = rgba(BRAND.goldenrod);
    const near = (c: readonly number[]) =>
      Math.abs(c[0] - gold[0]) + Math.abs(c[1] - gold[1]) + Math.abs(c[2] - gold[2]) < 90;
    expect(near(OCCUPANCY_COLORS.available.entire)).toBe(true);
    expect(near(OCCUPANCY_COLORS.client.entire)).toBe(false);
    expect(near(OCCUPANCY_COLORS.occupied.entire)).toBe(false);
    expect(near(occupancyColors('occupied', 'dark').entire)).toBe(false);
  });

  it('sits furthest out, so it wins a floor two things are true of', () => {
    const shared = computeBands(BUILDING, [
      ...spaceClaims([space({ floor_number: 14 })]),
      ...tenantClaims([tenant({ floor_numbers: [14] })]),
    ]);
    expect(shared).toHaveLength(2);
    // Different radii, or the two collars z-fight into a flickering mess.
    const spans = shared.map((b) => {
      const lons = b.polygon.map((p) => p[0]);
      return Math.max(...lons) - Math.min(...lons);
    });
    expect(spans[0]).not.toBeCloseTo(spans[1], 9);
  });

  it('gives the occupied tint a different value on each theme', () => {
    // A tint tuned for a white basemap disappears on a black one.
    expect(occupancyColors('occupied', 'dark').entire).not.toEqual(
      occupancyColors('occupied', 'light').entire,
    );
  });
});
