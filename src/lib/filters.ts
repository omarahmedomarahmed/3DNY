import type { BuildingWithSpaces, Filters, Space } from '@/types';

/**
 * Every column in the uploaded sheet is filterable. A space passes only if it
 * satisfies every active filter; inactive filters (null / empty array) are
 * ignored rather than treated as "match nothing".
 */
export function spaceMatches(
  space: Space,
  building: BuildingWithSpaces,
  f: Filters,
): boolean {
  if (!space.is_active) return false;

  // Asking rent. Withheld rents have no number, so they are included or
  // excluded wholesale rather than silently dropped by a range test.
  if (space.asking_rent_withheld || space.asking_rent_psf === null) {
    if (!f.includeWithheld) return false;
    if (f.rentMin !== null || f.rentMax !== null) {
      if (!f.includeWithheld) return false;
    }
  } else {
    if (f.rentMin !== null && space.asking_rent_psf < f.rentMin) return false;
    if (f.rentMax !== null && space.asking_rent_psf > f.rentMax) return false;
  }

  if (f.sfMin !== null && (space.sf ?? 0) < f.sfMin) return false;
  if (f.sfMax !== null && (space.sf ?? Number.MAX_SAFE_INTEGER) > f.sfMax) return false;

  if (f.floorMin !== null && (space.floor_number ?? -1) < f.floorMin) return false;
  if (f.floorMax !== null && (space.floor_number ?? Number.MAX_SAFE_INTEGER) > f.floorMax) {
    return false;
  }

  if (f.leaseTypes.length > 0 && (!space.lease_type || !f.leaseTypes.includes(space.lease_type))) {
    return false;
  }

  if (f.spaceUses.length > 0 && (!space.space_use || !f.spaceUses.includes(space.space_use))) {
    return false;
  }

  if (
    f.leasingCompanies.length > 0 &&
    (!space.leasing_company || !f.leasingCompanies.includes(space.leasing_company))
  ) {
    return false;
  }

  // Lease expiration. A space with no known expiry (Negotiable, "5 - 10 Years")
  // is excluded once an expiration window is active, because it cannot be
  // shown to satisfy it.
  if (f.expiresBefore !== null) {
    if (!space.term_expires || space.term_expires > f.expiresBefore) return false;
  }
  if (f.expiresAfter !== null) {
    if (!space.term_expires || space.term_expires < f.expiresAfter) return false;
  }

  if (f.availableBefore !== null) {
    if (!space.available_from || space.available_from > f.availableBefore) return false;
  }

  if (f.addedAfter !== null) {
    if (!space.date_added || space.date_added < f.addedAfter) return false;
  }

  // Building-level criteria applied per space so the map can dim a building
  // whose only matching spaces were filtered out.
  if (f.classes.length > 0 && !f.classes.includes(building.class)) return false;
  if (
    f.submarketClusters.length > 0 &&
    (!building.submarket_cluster || !f.submarketClusters.includes(building.submarket_cluster))
  ) {
    return false;
  }

  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    const haystack = [
      building.address_display,
      building.building_name,
      building.landlord_name,
      building.submarket_cluster,
      space.floor_label,
      space.leasing_company,
      space.agent_name,
      space.space_use,
      space.notes,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  return true;
}

/** Buildings with at least one passing space, carrying only those spaces. */
export function applyFilters(
  buildings: BuildingWithSpaces[],
  f: Filters,
): BuildingWithSpaces[] {
  const out: BuildingWithSpaces[] = [];
  for (const b of buildings) {
    const spaces = b.spaces.filter((s) => spaceMatches(s, b, f));
    if (spaces.length === 0) continue;
    out.push({ ...b, ...recomputeAggregates(b, spaces) });
  }
  return out;
}

export function recomputeAggregates(
  building: BuildingWithSpaces,
  spaces: Space[],
): BuildingWithSpaces {
  const rents = spaces
    .map((s) => s.asking_rent_psf)
    .filter((r): r is number => r !== null);
  return {
    ...building,
    spaces,
    minRent: rents.length ? Math.min(...rents) : null,
    maxRent: rents.length ? Math.max(...rents) : null,
    totalAvailableSf: spaces.reduce((sum, s) => sum + (s.sf ?? 0), 0),
    spaceCount: spaces.length,
  };
}

export function activeFilterCount(f: Filters): number {
  let n = 0;
  if (f.rentMin !== null || f.rentMax !== null) n++;
  if (!f.includeWithheld) n++;
  if (f.sfMin !== null || f.sfMax !== null) n++;
  if (f.floorMin !== null || f.floorMax !== null) n++;
  if (f.classes.length) n++;
  if (f.leaseTypes.length) n++;
  if (f.spaceUses.length) n++;
  if (f.submarketClusters.length) n++;
  if (f.leasingCompanies.length) n++;
  if (f.expiresBefore || f.expiresAfter) n++;
  if (f.availableBefore) n++;
  if (f.addedAfter) n++;
  if (f.search.trim()) n++;
  return n;
}

/** Distinct values for the filter rail's dropdowns, drawn from live data. */
export function filterOptions(buildings: BuildingWithSpaces[]) {
  const spaceUses = new Set<string>();
  const leasingCompanies = new Set<string>();
  const submarketClusters = new Set<string>();
  let rentMin = Infinity;
  let rentMax = -Infinity;
  let sfMin = Infinity;
  let sfMax = -Infinity;

  for (const b of buildings) {
    if (b.submarket_cluster) submarketClusters.add(b.submarket_cluster);
    for (const s of b.spaces) {
      if (s.space_use) spaceUses.add(s.space_use);
      if (s.leasing_company) leasingCompanies.add(s.leasing_company);
      if (s.asking_rent_psf !== null) {
        rentMin = Math.min(rentMin, s.asking_rent_psf);
        rentMax = Math.max(rentMax, s.asking_rent_psf);
      }
      if (s.sf !== null) {
        sfMin = Math.min(sfMin, s.sf);
        sfMax = Math.max(sfMax, s.sf);
      }
    }
  }

  const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));

  return {
    spaceUses: sorted(spaceUses),
    leasingCompanies: sorted(leasingCompanies),
    submarketClusters: sorted(submarketClusters),
    rentRange: Number.isFinite(rentMin) ? ([rentMin, rentMax] as [number, number]) : null,
    sfRange: Number.isFinite(sfMin) ? ([sfMin, sfMax] as [number, number]) : null,
  };
}
