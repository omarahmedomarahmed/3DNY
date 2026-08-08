-- 3DNYC schema. Idempotent: safe to run on every deploy.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Landlords: hand-authored insights, updated by sheet or in-app.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS landlords (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             text NOT NULL UNIQUE,
  aliases          text[] NOT NULL DEFAULT '{}',
  insights_md      text,
  amenities        text[] NOT NULL DEFAULT '{}',
  portfolio_sf     bigint,
  buildings_owned  integer,
  avg_asking_rent  numeric(10,2),
  notable_tenants  text[] NOT NULL DEFAULT '{}',
  contact_name     text,
  contact_email    text,
  contact_phone    text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Buildings: one row per physical building, keyed to NYC's BIN.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buildings (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  bin                   text,
  bbl                   text,
  address_normalized    text NOT NULL UNIQUE,
  address_display       text NOT NULL,
  building_name         text,
  landlord_id           uuid REFERENCES landlords(id) ON DELETE SET NULL,
  class                 text CHECK (class IN ('A','B','C')),
  submarket             text,
  submarket_cluster     text,
  num_floors            integer,
  height_roof_ft        numeric(8,2),
  year_built            integer,
  bldg_area_sf          bigint,
  centroid              geography(POINT, 4326),
  footprint             geography(POLYGON, 4326),
  match_confidence      text NOT NULL DEFAULT 'unmatched'
                          CHECK (match_confidence IN ('exact','fuzzy','manual','unmatched')),
  floor_height_override numeric(6,2),
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS buildings_bin_idx        ON buildings (bin);
CREATE INDEX IF NOT EXISTS buildings_centroid_idx   ON buildings USING GIST (centroid);
CREATE INDEX IF NOT EXISTS buildings_confidence_idx ON buildings (match_confidence);

-- ---------------------------------------------------------------------------
-- Imports: one row per uploaded sheet.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS imports (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  filename       text NOT NULL,
  market_label   text,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  row_count      integer NOT NULL DEFAULT 0,
  matched_exact  integer NOT NULL DEFAULT 0,
  matched_fuzzy  integer NOT NULL DEFAULT 0,
  unmatched      integer NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','committed','failed'))
);

-- ---------------------------------------------------------------------------
-- Spaces: one available space, one floor, one building.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spaces (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id           uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  floor_number          integer,
  floor_label           text NOT NULL,
  floor_portion         text NOT NULL DEFAULT 'entire'
                          CHECK (floor_portion IN ('entire','partial')),
  sf                    integer,
  asking_rent_psf       numeric(10,2),
  asking_rent_withheld  boolean NOT NULL DEFAULT false,
  space_use             text,
  lease_type            text CHECK (lease_type IN ('direct','sublet')),
  sub_landlord          text,
  occupancy_raw         text,
  available_from        date,
  term_raw              text,
  term_expires          date,
  leasing_company       text,
  agent_name            text,
  agent_email           text,
  agent_email_suspect   boolean NOT NULL DEFAULT false,
  date_added            date,
  source_import_id      uuid REFERENCES imports(id) ON DELETE SET NULL,
  notes                 text,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Re-importing the same sheet updates rather than duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS spaces_natural_key_idx
  ON spaces (building_id, floor_label, COALESCE(sf, -1), COALESCE(date_added, '1900-01-01'));

CREATE INDEX IF NOT EXISTS spaces_building_idx ON spaces (building_id);
CREATE INDEX IF NOT EXISTS spaces_active_idx   ON spaces (is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS spaces_expires_idx  ON spaces (term_expires);
CREATE INDEX IF NOT EXISTS spaces_rent_idx     ON spaces (asking_rent_psf);

-- ---------------------------------------------------------------------------
-- Photos for a space, stored in Vercel Blob.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS space_images (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id    uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  blob_url    text NOT NULL,
  caption     text,
  sort_order  integer NOT NULL DEFAULT 0,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS space_images_space_idx ON space_images (space_id, sort_order);

-- ---------------------------------------------------------------------------
-- Existing tenants. CSV or manual now, Salesforce later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id      uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  company_name     text NOT NULL,
  floors           text,
  sf               integer,
  lease_expiration date,
  industry         text,
  notes            text,
  source           text NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('csv','manual','salesforce')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenants_building_idx ON tenants (building_id);
CREATE INDEX IF NOT EXISTS tenants_expiry_idx   ON tenants (lease_expiration);

-- ---------------------------------------------------------------------------
-- Address aliases: the permanent memory that shrinks the review queue.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS address_aliases (
  raw_address text PRIMARY KEY,
  building_id uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['landlords','buildings','spaces','tenants'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_touch BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Landlord provenance. Added after the first release, so guarded.
-- ---------------------------------------------------------------------------
ALTER TABLE landlords ADD COLUMN IF NOT EXISTS owner_of_record text;
ALTER TABLE landlords ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE landlords ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Per-field provenance. Added after the first release, so guarded.
--
-- A row already records where it came from as a whole: source_import_id names
-- the sheet a space arrived on, and the enrichment pass fills a building's
-- dimensions from the city. What neither records is a field someone corrected
-- afterwards — once an asking rent has been retyped by hand it is
-- indistinguishable from the one the sheet supplied, and crediting the sheet
-- for a number nobody on the sheet wrote is worse than saying nothing.
--
-- This column holds one entry per field that has been written by something
-- other than the row's own origin:
--
--   {"asking_rent_psf": {"kind": "manual", "at": "2026-03-14T18:02:11.043Z"}}
--
-- `kind` is open on purpose. A Salesforce sync writing the same shape with
-- kind "salesforce" needs no schema change and no new resolver branch.
-- ---------------------------------------------------------------------------
ALTER TABLE spaces    ADD COLUMN IF NOT EXISTS field_sources jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS field_sources jsonb NOT NULL DEFAULT '{}'::jsonb;
