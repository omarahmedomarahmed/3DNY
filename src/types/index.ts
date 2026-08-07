// Core domain types for 3DNYC. This file is the contract every other
// module builds against — the map, the importer, the API routes and the UI.

export type MatchConfidence = 'exact' | 'fuzzy' | 'manual' | 'unmatched';
export type FloorPortion = 'entire' | 'partial';
export type LeaseType = 'direct' | 'sublet';
export type BuildingClass = 'A' | 'B' | 'C' | null;
export type TenantSource = 'csv' | 'manual' | 'salesforce';

/** A landlord / ownership entity. Insights here are authored by hand. */
export interface Landlord {
  id: string;
  name: string;
  aliases: string[];
  insights_md: string | null;
  amenities: string[];
  portfolio_sf: number | null;
  buildings_owned: number | null;
  avg_asking_rent: number | null;
  notable_tenants: string[];
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  updated_at: string;
}

/** A physical building, resolved to an NYC Building Identification Number. */
export interface Building {
  id: string;
  bin: string | null;
  bbl: string | null;
  address_normalized: string;
  address_display: string;
  building_name: string | null;
  landlord_id: string | null;
  landlord_name?: string | null;
  class: BuildingClass;
  submarket: string | null;
  submarket_cluster: string | null;
  num_floors: number | null;
  height_roof_ft: number | null;
  year_built: number | null;
  bldg_area_sf: number | null;
  lon: number | null;
  lat: number | null;
  /** Ring of [lon, lat] pairs. Null until the footprint join has run. */
  footprint: [number, number][] | null;
  match_confidence: MatchConfidence;
  /** Per-building override of the derived floor height, in feet. */
  floor_height_override: number | null;
  notes: string | null;
  updated_at: string;
}

/** One available space, one floor, in one building. */
export interface Space {
  id: string;
  building_id: string;
  floor_number: number | null;
  floor_label: string;
  floor_portion: FloorPortion;
  sf: number | null;
  asking_rent_psf: number | null;
  asking_rent_withheld: boolean;
  space_use: string | null;
  lease_type: LeaseType | null;
  sub_landlord: string | null;
  occupancy_raw: string | null;
  available_from: string | null;
  term_raw: string | null;
  term_expires: string | null;
  leasing_company: string | null;
  agent_name: string | null;
  agent_email: string | null;
  /** True when the source sheet truncated the email mid-address. */
  agent_email_suspect: boolean;
  date_added: string | null;
  source_import_id: string | null;
  notes: string | null;
  is_active: boolean;
  updated_at: string;
}

export interface SpaceImage {
  id: string;
  space_id: string;
  blob_url: string;
  caption: string | null;
  sort_order: number;
  uploaded_at: string;
}

export interface Tenant {
  id: string;
  building_id: string;
  company_name: string;
  floors: string | null;
  sf: number | null;
  lease_expiration: string | null;
  industry: string | null;
  notes: string | null;
  source: TenantSource;
  updated_at: string;
}

export interface ImportRecord {
  id: string;
  filename: string;
  market_label: string | null;
  uploaded_at: string;
  row_count: number;
  matched_exact: number;
  matched_fuzzy: number;
  unmatched: number;
  status: 'pending' | 'committed' | 'failed';
}

/** A raw address permanently pinned to a building by a human. */
export interface AddressAlias {
  raw_address: string;
  building_id: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Import pipeline
// ---------------------------------------------------------------------------

/** One parsed CSV row, before any building matching has happened. */
export interface ParsedRow {
  rowNumber: number;
  addressRaw: string;
  addressDisplay: string;
  buildingName: string | null;
  dateAdded: string | null;
  floorLabel: string;
  floorNumber: number | null;
  floorPortion: FloorPortion;
  sf: number | null;
  askingRentPsf: number | null;
  askingRentWithheld: boolean;
  spaceUse: string | null;
  leaseType: LeaseType | null;
  subLandlord: string | null;
  occupancyRaw: string | null;
  availableFrom: string | null;
  termRaw: string | null;
  termExpires: string | null;
  leasingCompany: string | null;
  agentName: string | null;
  agentEmail: string | null;
  agentEmailSuspect: boolean;
  buildingClass: BuildingClass;
  /** From the sheet's "Submarket Cluster" column, e.g. "Midtown South". */
  submarket: string | null;
  /** From the sheet's "Submarket Notes" column, e.g. "Grand Central". */
  submarketCluster: string | null;
  notes: string | null;
  warnings: string[];
}

export interface ParseResult {
  marketLabel: string | null;
  rows: ParsedRow[];
  duplicatesRemoved: number;
  errors: string[];
}

/** A parsed row after the geocoder has tried to find its building. */
export interface MatchedRow extends ParsedRow {
  match: {
    confidence: MatchConfidence;
    bin: string | null;
    bbl: string | null;
    lon: number | null;
    lat: number | null;
    resolvedAddress: string | null;
    buildingId: string | null;
    /** Why the match landed where it did — shown in the review queue. */
    explanation: string;
  };
}

// ---------------------------------------------------------------------------
// Map + UI
// ---------------------------------------------------------------------------

/** A building joined with its spaces, as the map and sidebar consume it. */
export interface BuildingWithSpaces extends Building {
  spaces: Space[];
  tenants?: Tenant[];
  /** Cheapest non-withheld asking rent across active spaces. */
  minRent: number | null;
  maxRent: number | null;
  totalAvailableSf: number;
  spaceCount: number;
}

/** A vertical band drawn on a tower for one available floor. */
export interface FloorBand {
  spaceId: string;
  buildingId: string;
  floorNumber: number;
  portion: FloorPortion;
  /** Feet above ground for the bottom and top of the band. */
  baseFt: number;
  topFt: number;
  polygon: [number, number][];
  approximate: boolean;
}

export type ColorMode = 'rent' | 'availability' | 'class' | 'sf';

export interface Filters {
  rentMin: number | null;
  rentMax: number | null;
  includeWithheld: boolean;
  sfMin: number | null;
  sfMax: number | null;
  floorMin: number | null;
  floorMax: number | null;
  classes: BuildingClass[];
  leaseTypes: LeaseType[];
  spaceUses: string[];
  submarketClusters: string[];
  leasingCompanies: string[];
  /** Lease expiration window. */
  expiresBefore: string | null;
  expiresAfter: string | null;
  /** Availability window. */
  availableBefore: string | null;
  addedAfter: string | null;
  search: string;
}

export const EMPTY_FILTERS: Filters = {
  rentMin: null,
  rentMax: null,
  includeWithheld: true,
  sfMin: null,
  sfMax: null,
  floorMin: null,
  floorMax: null,
  classes: [],
  leaseTypes: [],
  spaceUses: [],
  submarketClusters: [],
  leasingCompanies: [],
  expiresBefore: null,
  expiresAfter: null,
  availableBefore: null,
  addedAfter: null,
  search: '',
};
