import { describe, expect, it } from 'vitest';
import { filterOptions } from '@/lib/filters';
import type { BuildingWithSpaces, Space } from '@/types';

/**
 * A filter that can empty the map has to say so from the data.
 *
 * The rail's asking-rent group carries a checkbox for withheld rents and a
 * sentence under it explaining how much is affected. That sentence was
 * hardcoded to "roughly half", which was true of the leasing team's own
 * spreadsheets. Read off landlord pages, essentially nothing quotes a rent —
 * unticking the box took 312 listings down to one, under a label that said
 * it would cost about half.
 */

const space = (rent: number | null): Space =>
  ({
    id: Math.random().toString(36).slice(2),
    asking_rent_psf: rent,
    asking_rent_withheld: rent === null,
    is_active: true,
    space_use: 'Office',
    leasing_company: 'SL Green Realty Corp.',
    sf: 5000,
  }) as unknown as Space;

const building = (spaces: Space[]): BuildingWithSpaces =>
  ({ id: 'b1', submarket_cluster: 'Midtown', spaces }) as unknown as BuildingWithSpaces;

describe('filterOptions withheld share', () => {
  it('reports the real proportion, not a remembered one', () => {
    const options = filterOptions([building([space(null), space(null), space(null), space(80)])]);
    expect(options.spaceCount).toBe(4);
    expect(options.withheldShare).toBe(0.75);
  });

  it('reads a market that quotes nothing as all of it', () => {
    const options = filterOptions([building([space(null), space(null)])]);
    expect(options.withheldShare).toBe(1);
    // And the rent range has nothing to draw, rather than a range of zero.
    expect(options.rentRange).toBeNull();
  });

  it('reads a market that quotes everything as none of it', () => {
    const options = filterOptions([building([space(60), space(90)])]);
    expect(options.withheldShare).toBe(0);
    expect(options.rentRange).toEqual([60, 90]);
  });

  it('does not divide by zero on an empty map', () => {
    const options = filterOptions([]);
    expect(options.withheldShare).toBe(0);
    expect(options.spaceCount).toBe(0);
  });
});
