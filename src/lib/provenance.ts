import type { Building, FieldSourceStamp, Landlord, Space } from '@/types';

/**
 * Where every number, name and date on the screen came from.
 *
 * This map mixes four kinds of truth and shows them in the same typeface:
 *
 *   - what a leasing sheet said, which is a claim by whoever wrote the sheet;
 *   - what the City of New York recorded, which is a public record;
 *   - what somebody on this team typed, which is a correction;
 *   - what this app worked out, which is arithmetic on the other three.
 *
 * They are not equally reliable, and a room full of people making a decision
 * cannot tell them apart by looking. "Class A, 1962, 41 floors, $88/SF" reads
 * as one continuous fact. Two of those came off an aerial survey of the tax
 * lot, one came off a spreadsheet, and one may have been retyped this morning.
 *
 * So every value that reaches a screen can name its own source. The module is
 * built around three rules:
 *
 * 1. **The resolver never guesses.** If a field has been overwritten since the
 *    row was created, the stamp on the row says so and that wins. Otherwise
 *    the field's origin is a property of the field itself, decided in the
 *    tables below and not at the call site — a component asking "where did
 *    this come from" must not be in a position to answer it wrongly.
 *
 * 2. **An estimate says it is an estimate.** Floor heights derived from roof
 *    height ÷ floor count, walk times from straight-line distance, and floor
 *    band positions on a building with no recorded height are all marked
 *    `approximate`. Those are the values a broker would be embarrassed to be
 *    challenged on.
 *
 * 3. **An unknown source degrades, it does not vanish.** A Salesforce sync,
 *    or anything else writing a stamp kind this file has never heard of, still
 *    renders as "recorded by <kind>" with its timestamp. Silence would read as
 *    "off the sheet", which would be a lie.
 */

// ---------------------------------------------------------------------------
// The catalogue of sources
// ---------------------------------------------------------------------------

export type SourceKind =
  /** An availability sheet uploaded through the importer. */
  | 'sheet'
  /** Typed or corrected by someone on this team, in this app. */
  | 'manual'
  /** Synced from the CRM. Nothing writes this yet; the resolver handles it. */
  | 'salesforce'
  /** NYC Department of City Planning's tax-lot extract. */
  | 'pluto'
  /** NYC Building Footprints — outlines and roof heights. */
  | 'footprints'
  /** NYC Geosearch / AddressPoint — the address-to-BIN match. */
  | 'geocode'
  /** NYC Street Centerline — street names and the walking network. */
  | 'centerline'
  /** MTA / NY State open data — stations, stops and routes. */
  | 'mta'
  /** Worked out by this app from the values around it. */
  | 'derived';

export interface SourceDataset {
  /** Popover heading. Short enough to read at a glance. */
  name: string;
  /** One sentence: what it is and who publishes it. */
  blurb: string;
  /** Public landing page, when the source has one. */
  href?: string;
}

export const SOURCES: Record<SourceKind, SourceDataset> = {
  sheet: {
    name: 'Imported sheet',
    blurb: 'Read from an availability sheet uploaded to this app. It is a claim by whoever compiled the sheet, not a public record.',
  },
  manual: {
    name: 'Entered here',
    blurb: 'Typed or corrected by someone on this team, in this app.',
  },
  salesforce: {
    name: 'Salesforce',
    blurb: 'Synced from the CRM record.',
  },
  pluto: {
    name: 'NYC MapPLUTO',
    blurb:
      "The Department of City Planning's tax-lot extract: floor count, year built, building area and owner of record.",
    href: 'https://www.nyc.gov/content/planning/pages/resources/datasets/mappluto-pluto-change',
  },
  footprints: {
    name: 'NYC Building Footprints',
    blurb:
      "The city's survey of every building outline and roof height, captured from aerial imagery.",
    href: 'https://data.cityofnewyork.us/Housing-Development/Building-Footprints/5zhs-2jue',
  },
  geocode: {
    name: 'NYC address index',
    blurb:
      "The address was matched against the city's own index (Geosearch, falling back to AddressPoint) to find its building number, tax lot and coordinates.",
    href: 'https://geosearch.planninglabs.nyc/',
  },
  centerline: {
    name: 'NYC Street Centerline',
    blurb: "The city's street network — where street names and walking routes come from.",
    href: 'https://data.cityofnewyork.us/City-Government/NYC-Street-Centerline-CSCL-/exjm-f27b',
  },
  mta: {
    name: 'MTA open data',
    blurb:
      'Station names, entrance locations and route designations published by the MTA on the state open-data portal.',
    href: 'https://data.ny.gov/Transportation/MTA-Subway-Stations/39hk-dx4f',
  },
  derived: {
    name: 'Calculated here',
    blurb: 'Worked out by this app from the values around it. Not read from any record.',
  },
};

/**
 * One resolved answer to "where did this value come from".
 *
 * `label` is the line the popover leads with — the specific sheet, dataset or
 * calculation. `detail` is the sentence under it. Neither is ever empty.
 */
export interface SourceNote {
  kind: SourceKind | 'unknown';
  label: string;
  detail: string;
  href?: string;
  /** True when the value is an estimate rather than a recorded figure. */
  approximate?: boolean;
  /** ISO timestamp of when the value was written, when it is known. */
  at?: string;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** ISO → "Mar 14, 2026". UTC throughout, so an evening never moves a date. */
export function formatSourceDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const trimmed = iso.trim();
  if (!trimmed) return null;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * A stamp left by whatever last wrote the field.
 *
 * A kind this file does not recognise still produces a usable note. The point
 * of the stamp is that the value did NOT come from where the row came from,
 * and that stays true whether or not we know what wrote it.
 */
function stampNote(stamp: FieldSourceStamp): SourceNote {
  const when = formatSourceDate(stamp.at);
  const known = (Object.keys(SOURCES) as SourceKind[]).includes(stamp.kind as SourceKind);

  if (!known) {
    return {
      kind: 'unknown',
      label: `Recorded by ${stamp.kind}`,
      detail:
        `This value was written by ${stamp.kind}` +
        (when ? ` on ${when}` : '') +
        `, so it did not come from the source the rest of this record did.` +
        (stamp.ref ? ` Reference ${stamp.ref}.` : ''),
      at: stamp.at,
    };
  }

  const kind = stamp.kind as SourceKind;
  const dataset = SOURCES[kind];

  if (kind === 'manual') {
    return {
      kind,
      label: when ? `Corrected here on ${when}` : 'Corrected here',
      detail:
        'Someone on this team overwrote this field in the app. It no longer matches whatever the ' +
        'original source said.',
      at: stamp.at,
    };
  }

  return {
    kind,
    label: when ? `${dataset.name}, ${when}` : dataset.name,
    detail: dataset.blurb + (stamp.ref ? ` Reference ${stamp.ref}.` : ''),
    href: dataset.href,
    at: stamp.at,
  };
}

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

/**
 * Every space value that reaches a screen, plus the derived ones.
 *
 * Derived entries have no database column — they exist because a broker reads
 * "$4.4M/yr" as a fact, and it is a multiplication of two other facts, either
 * of which might be an estimate.
 */
export type SpaceField =
  | 'floor_label'
  | 'floor_number'
  | 'floor_portion'
  | 'sf'
  | 'asking_rent_psf'
  | 'space_use'
  | 'lease_type'
  | 'sub_landlord'
  | 'available_from'
  | 'term_expires'
  | 'leasing_company'
  | 'date_added'
  | 'notes'
  | 'annual_rent'
  | 'floor_band';

const SPACE_DERIVED: Partial<Record<SpaceField, SourceNote>> = {
  annual_rent: {
    kind: 'derived',
    label: 'Asking rent × square feet',
    detail:
      'Not a quoted figure. This app multiplies the asking rent per square foot by the size, both ' +
      'as stated on the sheet. Nobody has offered this number.',
    approximate: true,
  },
  floor_band: {
    kind: 'derived',
    label: 'Floor number × floor height',
    detail:
      'Where the highlighted band sits on the tower. Floor height comes from the roof height ' +
      'divided by the floor count when the building has both recorded, and from a standard ' +
      'estimate when it does not.',
    approximate: true,
  },
};

/**
 * A space is a row off a sheet. Every stored field on it came from that sheet
 * or from a person, and nothing on a space comes from a public record — the
 * city does not publish what a floor is asking.
 */
export function spaceSource(space: Space, field: SpaceField): SourceNote {
  const stamp = space.field_sources?.[field];
  if (stamp) return stampNote(stamp);

  const derived = SPACE_DERIVED[field];
  if (derived) return derived;

  return spaceOriginNote(space);
}

/** The row's own origin: which sheet it arrived on, or a person. */
export function spaceOriginNote(space: Space): SourceNote {
  if (!space.source_import_id) {
    const when = formatSourceDate(space.updated_at);
    return {
      kind: 'manual',
      label: when ? `Entered here, last edited ${when}` : 'Entered here',
      detail:
        'This space was created by hand in the app rather than imported from a sheet.',
      at: space.updated_at,
    };
  }

  const sheet = space.import_filename ?? `import ${space.source_import_id.slice(0, 8)}`;
  const when = formatSourceDate(space.import_uploaded_at ?? space.date_added);
  return {
    kind: 'sheet',
    label: when ? `${sheet}, imported ${when}` : sheet,
    detail: SOURCES.sheet.blurb,
    at: space.import_uploaded_at ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export type BuildingField =
  | 'address_display'
  | 'building_name'
  | 'class'
  | 'submarket'
  | 'submarket_cluster'
  | 'bin'
  | 'bbl'
  | 'num_floors'
  | 'year_built'
  | 'bldg_area_sf'
  | 'height_roof_ft'
  | 'floor_height_override'
  | 'landlord_name'
  | 'notes'
  | 'coordinates'
  | 'footprint'
  | 'floor_height'
  | 'availability_summary';

/**
 * Which source fills each building field when nothing has overwritten it.
 *
 * The split matters and is easy to get backwards: the address, name, class and
 * submarket are what the SHEET called the building — brokers' shorthand, not
 * the city's record. The dimensions are the city's, and the identifiers are
 * the match between the two.
 */
const BUILDING_ORIGIN: Record<BuildingField, SourceKind> = {
  address_display: 'sheet',
  building_name: 'sheet',
  class: 'sheet',
  submarket: 'sheet',
  submarket_cluster: 'sheet',
  bin: 'geocode',
  bbl: 'geocode',
  coordinates: 'geocode',
  footprint: 'footprints',
  height_roof_ft: 'footprints',
  num_floors: 'pluto',
  year_built: 'pluto',
  bldg_area_sf: 'pluto',
  landlord_name: 'pluto',
  floor_height_override: 'manual',
  notes: 'manual',
  floor_height: 'derived',
  availability_summary: 'derived',
};

const BUILDING_DETAIL: Partial<Record<BuildingField, string>> = {
  address_display:
    'The address as the availability sheet wrote it, kept verbatim so it matches what a broker ' +
    'would search for.',
  building_name: 'The building name as the availability sheet wrote it.',
  class:
    'Building class as stated on the availability sheet. Class is a market convention, not a ' +
    'recorded fact — the city does not publish it.',
  submarket: 'The submarket as labelled on the availability sheet.',
  submarket_cluster: 'The submarket cluster as labelled on the availability sheet.',
  bin:
    "The Building Identification Number the address matched to. This is the key everything else " +
    'the city knows about the building hangs off.',
  bbl: 'The Borough-Block-Lot tax identifier the address matched to.',
  coordinates:
    "Where the building sits, from the city's address index. This is what puts the tower on the " +
    'map in the right place.',
  footprint:
    "The building's real outline, from the city's aerial survey. The survey predates the newest " +
    'towers, so a very recent building can be missing or short.',
  height_roof_ft:
    "Roof height from the city's aerial survey, in feet above ground.",
  num_floors: "Floor count from the city's tax-lot record.",
  year_built: "Year built from the city's tax-lot record.",
  bldg_area_sf: "Total building area from the city's tax-lot record.",
  landlord_name:
    "Seeded from the owner of record on the city's tax-lot record. That is often a holding " +
    'company rather than the operating landlord, which is why it is flagged for review until ' +
    'someone confirms it.',
  floor_height_override: 'A floor height set by hand for this building, overriding the estimate.',
  notes: 'Written by someone on this team.',
};

const BUILDING_DERIVED: Partial<Record<BuildingField, SourceNote>> = {
  floor_height: {
    kind: 'derived',
    label: 'Roof height ÷ floor count',
    detail:
      "Not a recorded figure. Where the city has both a roof height and a floor count, this app " +
      'divides one by the other; otherwise it falls back to a standard floor height. It is what ' +
      'positions every availability band on the tower.',
    approximate: true,
  },
  availability_summary: {
    kind: 'derived',
    label: 'Totalled from this building’s spaces',
    detail:
      'Added up from the individual availabilities below. It carries whatever each of those ' +
      'carries — a withheld asking rent is left out of the range rather than counted as zero.',
  },
};

export function buildingSource(building: Building, field: BuildingField): SourceNote {
  const stamp = building.field_sources?.[field];
  if (stamp) return stampNote(stamp);

  const derived = BUILDING_DERIVED[field];
  if (derived) return derived;

  const kind = BUILDING_ORIGIN[field];
  const dataset = SOURCES[kind];
  const detail = BUILDING_DETAIL[field] ?? dataset.blurb;

  // An approximate address match makes every identifier hanging off it
  // provisional, and that has to be said on the identifier, not buried in a
  // banner at the top of a page nobody scrolled to.
  const shaky =
    building.match_confidence === 'fuzzy' || building.match_confidence === 'unmatched';
  const identifier = kind === 'geocode' || kind === 'pluto' || kind === 'footprints';

  if (identifier && shaky) {
    return {
      kind,
      label: `${dataset.name} — match not confirmed`,
      detail:
        `${detail} The address matched “${building.match_confidence}”, so this may belong to a ` +
        'different building. Confirm before quoting it.',
      href: dataset.href,
      approximate: true,
    };
  }

  return { kind, label: dataset.name, detail, href: dataset.href };
}

// ---------------------------------------------------------------------------
// Landlords
// ---------------------------------------------------------------------------

export type LandlordField =
  | 'name'
  | 'owner_of_record'
  | 'insights_md'
  | 'amenities'
  | 'notable_tenants'
  | 'portfolio_sf'
  | 'buildings_owned'
  | 'avg_asking_rent'
  | 'contact';

export function landlordSource(landlord: Landlord, field: LandlordField): SourceNote {
  if (field === 'owner_of_record') {
    return {
      kind: 'pluto',
      label: SOURCES.pluto.name,
      detail:
        "The owner name on the city's tax-lot record. Deeds are frequently held by single-purpose " +
        'LLCs, so this is often not the name anyone in the market uses.',
      href: SOURCES.pluto.href,
    };
  }

  if (field === 'name') {
    if (landlord.source === 'city_record') {
      return {
        kind: 'pluto',
        label: landlord.needs_review
          ? `${SOURCES.pluto.name} — not yet confirmed`
          : SOURCES.pluto.name,
        detail: landlord.needs_review
          ? "Seeded from the city's owner of record and not yet confirmed by anyone here. It may " +
            'be a holding company rather than the operating landlord.'
          : "Seeded from the city's owner of record and confirmed by someone on this team.",
        href: SOURCES.pluto.href,
        approximate: landlord.needs_review,
      };
    }
    return {
      kind: 'manual',
      label: 'Entered here',
      detail: 'The landlord name as someone on this team recorded it.',
    };
  }

  // The edit date lives in the sentence rather than the label on purpose.
  // Compare collapses a row to one marker when every column gives the same
  // answer, and every column here DOES give the same answer — "we wrote it".
  // Putting three different dates in three labels would fragment that row into
  // three markers that all say the same thing.
  const written = formatSourceDate(landlord.updated_at);
  return {
    kind: 'manual',
    label: 'Entered here',
    detail:
      'Hand-authored by this team. Nothing on this panel is a public record — it is what we know ' +
      'about the landlord, kept up to date by whoever last edited it.' +
      (written ? ` Last edited ${written}.` : ''),
    at: landlord.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

/**
 * Who is in the building today.
 *
 * None of this is public record — the city does not publish tenancies — so the
 * only question is whether a person typed it or a sheet carried it. The
 * `source` column on the row already answers that; this turns it into a
 * sentence.
 */
export function tenantSource(source: string): SourceNote {
  if (source === 'salesforce') {
    return {
      kind: 'salesforce',
      label: SOURCES.salesforce.name,
      detail: 'Synced from the CRM record for this building.',
    };
  }
  if (source === 'csv') {
    return {
      kind: 'sheet',
      label: 'Imported tenant sheet',
      detail:
        'Read from a tenant roster uploaded to this app. Tenancies are not public record, so this ' +
        'is as current as the sheet that carried it.',
    };
  }
  return {
    kind: 'manual',
    label: 'Entered here',
    detail:
      'Typed in by someone on this team. Tenancies are not public record — there is no dataset ' +
      'to check this against.',
  };
}

// ---------------------------------------------------------------------------
// Transit
// ---------------------------------------------------------------------------

export type TransitField = 'name' | 'routes' | 'location' | 'walk_time' | 'walk_route';

/**
 * Stations and stops.
 *
 * The rail terminals, PATH stations and ferry landings are a hand-kept table
 * in `transit.ts` — there is no maintained open dataset for the last two — so
 * those say so rather than claiming the MTA published them.
 */
export function transitSource(field: TransitField, mode?: string): SourceNote {
  if (field === 'walk_time') {
    return {
      kind: 'derived',
      label: 'Estimated from distance',
      detail:
        'A walking pace applied to the distance from the selected building. It does not account ' +
        'for the actual route, crossings or waiting.',
      approximate: true,
    };
  }

  if (field === 'walk_route') {
    return {
      kind: 'centerline',
      label: SOURCES.centerline.name,
      detail:
        "Routed along the city's street network, so the line follows real streets rather than " +
        'cutting through blocks. The path is the shortest one on that network, not necessarily ' +
        'the one a person would take.',
      href: SOURCES.centerline.href,
      approximate: true,
    };
  }

  const handKept = mode === 'ferry' || mode === 'path' || mode === 'rail';
  if (handKept) {
    return {
      kind: 'manual',
      label: 'Maintained by hand',
      detail:
        'There is no maintained open dataset for NYC Ferry landings or PATH stations, so these ' +
        'fifteen stops are a short table kept in this app. Coordinates are the passenger ' +
        'entrance.',
    };
  }

  return {
    kind: 'mta',
    label: SOURCES.mta.name,
    detail: SOURCES.mta.blurb,
    href: SOURCES.mta.href,
  };
}

// ---------------------------------------------------------------------------
// Streets
// ---------------------------------------------------------------------------

export function streetSource(): SourceNote {
  return {
    kind: 'centerline',
    label: SOURCES.centerline.name,
    detail: SOURCES.centerline.blurb,
    href: SOURCES.centerline.href,
  };
}

// ---------------------------------------------------------------------------
// Whole-record summaries
// ---------------------------------------------------------------------------

/**
 * Every source behind one space, as sentences.
 *
 * The stack snapshot is a PNG that leaves the building and gets forwarded, so
 * it cannot carry an interactive affordance. It gets this instead, printed in
 * the footer — the same facts the "i" would have given, in a form that
 * survives being emailed.
 */
export function spaceSourceSummary(space: Space, building: Building): string[] {
  return recordSourceSummary(building, [space]);
}

/**
 * The same, for a whole stack — every space on one building.
 *
 * Sheets are listed once each rather than once per floor, because a twelve
 * floor stack off one sheet should not produce twelve identical lines.
 */
export function recordSourceSummary(building: Building, spaces: Space[]): string[] {
  const lines: string[] = [];

  const sheets: string[] = [];
  for (const space of spaces) {
    const label = spaceOriginNote(space).label;
    if (!sheets.includes(label)) sheets.push(label);
  }
  if (sheets.length > 0) {
    lines.push(`Availability figures: ${sheets.join('; ')}.`);
  }

  const corrected: string[] = [];
  for (const space of spaces) {
    for (const [field, stamp] of Object.entries(space.field_sources ?? {})) {
      if (stamp.kind !== 'manual') continue;
      const name = field.replace(/_/g, ' ');
      if (!corrected.includes(name)) corrected.push(name);
    }
  }
  if (corrected.length > 0) {
    lines.push(`Corrected by hand since import: ${corrected.join(', ')}.`);
  }

  const cityParts: string[] = [];
  if (building.num_floors !== null || building.year_built !== null) {
    cityParts.push('floor count and year built from NYC MapPLUTO');
  }
  if (building.height_roof_ft !== null || building.footprint !== null) {
    cityParts.push('outline and roof height from NYC Building Footprints');
  }
  if (building.bin) cityParts.push(`matched to BIN ${building.bin}`);
  if (cityParts.length > 0) {
    lines.push(`Building: ${cityParts.join('; ')}.`);
  }

  if (building.match_confidence === 'fuzzy' || building.match_confidence === 'unmatched') {
    lines.push(
      `Address match is “${building.match_confidence}” — the city record may belong to a ` +
        'different building.',
    );
  }

  return lines;
}
