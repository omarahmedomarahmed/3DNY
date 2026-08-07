# 3DNYC — Build Plan (Prototype v1)

**Status:** planning complete, build not started
**Target:** a link you send to senior partners. They open it, it works. No login.
**Scope:** Midtown + Midtown South. Spaces-added data only. No Salesforce, no Placer.ai.

---

## 1. What this prototype does

| # | Capability | Detail |
|---|---|---|
| 1 | Upload a sheet | Drag the weekly "Space Added This Week" CSV onto the page. It parses, geocodes, and lands on the map in seconds. |
| 2 | Buildings highlight | Every building with available space glows on a 3D Manhattan map. Colour encodes asking rent (or availability, or class — switchable). |
| 3 | Click a building | Opens the building profile: all available spaces, existing tenants, landlord insights, class, submarket. |
| 4 | Floor-level highlights | Zoom into a building and each available floor renders as its own highlighted band on the tower. Click a band → that space's detail. |
| 5 | Space detail | Floor, SF, asking rent, use, direct/sublet, occupancy, term, leasing company, agent + email, notes, **photos**. |
| 6 | Compare tray | Add a space from one building, fly to another building, add a space from a different floor, add a third. Opens side-by-side spec comparison — including landlord data for each. |
| 7 | Radius comps | Drop a radius around any building. Every available space inside it lists instantly, comparable and addable to the compare tray. |
| 8 | Filters | Lease expiration, asking-rent range, SF range, floor, class, direct vs sublet, space use, submarket cluster, leasing company, date added — every column in the upload. |
| 9 | Edit anything | Every imported row is editable in-app. Add photos to a space. Correct a floor. Fix an address match. |
| 10 | Tenants | Editable per building. Seeded by CSV now, pulled from Salesforce later. |
| 11 | Landlord profiles | Manually authored insights, amenities, portfolio numbers. Seeded by CSV or typed in-app. Appear on the building profile and in compare. |

---

## 2. The two hard problems

Everything else is straightforward. These two decide whether the demo lands.

### 2.1 Address → building (must be exact)

The sheet gives a free-text address. The map needs a **BIN** (NYC Building Identification Number). Wrong building highlighted in front of a partner is worse than no map.

Pipeline:

| Step | Method | Handles |
|---|---|---|
| 1 | Strip building name after `" - "` | `60 E 42nd Street - One Grand Central Place` → `60 E 42nd Street` |
| 2 | Normalise | `Street`→`ST`, `Avenue`→`AVE`, ordinals, directionals (`W`/`WEST`) |
| 3 | Address-range split | `22-30 Little W 12th Street` → try `22`, then `30`, then the range midpoint |
| 4 | NYC Geosearch API (`geosearch.planninglabs.nyc`, free, no key) | Returns BBL + BIN + lat/lon |
| 5 | PLUTO join on BBL | Returns `NumFloors`, `YearBuilt`, `BldgArea`, owner name |
| 6 | Footprint join on BIN | Returns the polygon and `HEIGHTROOF` |
| 7 | **Confidence flag** | `exact` / `fuzzy` / `unmatched` stored per building |

**Unmatched and fuzzy rows do not silently disappear.** They land in a Review queue on the import screen with a map picker — click the right building, it's locked in forever.

Known cases already visible in the sample data:

| Address in sheet | Problem | Resolution |
|---|---|---|
| `One Soho Sq` | No street number at all | Manual pick → aliased permanently to `233 Spring Street` |
| `24-32 Union Sq E` | Hyphenated range, abbreviated `Sq E` | Range split + normalisation |
| `20-28 W 33rd Street` | Range | Range split |
| `100 Park Avenue - The Emporis Building` | Name suffix | Split on `" - "` |

Once a building is matched, the mapping is cached. Next week's sheet resolves it instantly with no review step. **The review queue shrinks to near zero after two or three imports.**

### 2.2 Floor-level highlighting (be honest about precision)

The building match is exact. The **floor band is an estimate**, and the plan says so out loud:

```
floor_height    = HEIGHTROOF / PLUTO.NumFloors
band_bottom     = ground_elevation + (floor_number - 1) × floor_height
band_top        = band_bottom + floor_height
```

Rendered as a coloured extruded slab on the tower face, inset slightly from the footprint so it reads as a band rather than a re-skin.

| What | Accuracy |
|---|---|
| Which building | Exact (BIN) |
| Which floor is available | Exact (from the sheet) |
| Where that floor sits vertically | ±1 floor on towers with mechanical floors, double-height lobbies, or setbacks |

For a pitch meeting this is right. Partners read "floor 45 of this tower is available", not a surveyed elevation. `Partial` floors render at 60% opacity with a hatch; `Entire` floors render solid. If a specific trophy tower needs exact floor elevations later, they can be overridden per building in the editor.

---

## 3. Data model

```
landlords
  id, name, aliases[], insights_md, amenities[], portfolio_sf,
  buildings_owned, avg_asking_rent, notable_tenants[],
  contact_name, contact_email, contact_phone, updated_at, updated_by

buildings
  id, bin, bbl, address_normalized, address_display, building_name,
  landlord_id → landlords, class, submarket, submarket_cluster,
  num_floors, height_roof_ft, year_built, bldg_area_sf,
  centroid geography(POINT), footprint geography(POLYGON),
  match_confidence ∈ {exact, fuzzy, manual, unmatched},
  notes, updated_at

spaces
  id, building_id → buildings, floor_number, floor_label,        -- "Entire 8th"
  floor_portion ∈ {entire, partial}, sf, asking_rent_psf,        -- null = Withheld
  asking_rent_withheld bool, space_use, lease_type ∈ {direct, sublet},
  sub_landlord, occupancy_raw, available_from date,              -- "Vacant" → today
  term_raw, term_expires date,                                   -- "Thru Mar 2033" → 2033-03-31
  leasing_company, agent_name, agent_email,
  date_added, source_import_id, notes, is_active, updated_at

space_images
  id, space_id → spaces, blob_url, caption, sort_order, uploaded_at

tenants
  id, building_id → buildings, company_name, floors, sf,
  lease_expiration date, industry, notes, source ∈ {csv, manual, salesforce},
  updated_at

imports
  id, filename, market_label, uploaded_at, row_count,
  matched_exact, matched_fuzzy, unmatched, status

address_aliases
  raw_address, building_id → buildings, created_by, created_at
  -- the permanent memory that makes the review queue shrink
```

`compare_tray` is client-side only (URL-encoded so a comparison is shareable as a link).

---

## 4. CSV contract

The sheet format is taken as-is. **No one has to change how they produce it.**

| Sheet row | Content |
|---|---|
| Row 1 | Market label (`Midtown`, `Midtown South`) — captured as `imports.market_label` |
| Row 2 | Blank — skipped |
| Row 3 | Header |
| Row 4+ | Data |

| Column | Parsed to | Rule |
|---|---|---|
| `Address` | `address_display`, `building_name` | Split on `" - "` |
| `Date Added` | `date_added` | `MM/DD/YYYY` |
| `Floor` | `floor_portion`, `floor_number`, `floor_label` | `Entire 8th` → entire, 8 |
| `SF` | `sf` | Strip commas |
| `Asking Rent` | `asking_rent_psf` or `asking_rent_withheld` | `Withheld` → null + flag |
| `Space Use` | `space_use` | `Office`, `Off/Ret`, `Off/Med` |
| `Type` | `lease_type` | `Direct` / `Sublet` |
| `Sub-LL` | `sub_landlord` | |
| `Occupany` *(sic)* | `available_from` | `Vacant`→today, `30 Days`→+30d, `Sep 2025`→2025-09-01 |
| `Term` | `term_expires` | `Thru Mar 2033`→2033-03-31; `Negotiable`/`5 - 10 Years`→null |
| `Leasing Company` | `leasing_company` | |
| `Agent` / `Agent email` | `agent_name` / `agent_email` | Emails in the sample are truncated — flagged for review, not dropped |
| `Class` | `class` | A / B / C |
| `Submarket Cluster` | `submarket_cluster` | |
| `Notes` | `notes` | |

**Deduplication:** identical `(address, floor, sf, date_added)` collapses to one row. The sample already contains one — `118 W 22nd Street, Entire 12th` appears twice.

**Re-import behaviour:** same building + floor + date = update, not duplicate. Spaces absent from a newer sheet for the same market are marked `is_active = false`, not deleted, so history survives.

---

## 5. Screens

| Screen | Contents |
|---|---|
| **Map** (home) | 3D Manhattan, highlighted buildings, filter rail, viewport-synced sidebar list, compare tray docked at the bottom |
| **Building profile** | Header (address, name, class, landlord, submarket) · Available spaces table · Current tenants table · Landlord insights panel · 3D inset with floor bands · Edit buttons throughout |
| **Space detail** | Full spec, photo gallery, agent contact, "Add to compare", "Find comps within ¼ mile" |
| **Compare** | Side-by-side columns, N spaces wide, with rows for every spec + landlord data. Differences highlighted. Shareable URL. |
| **Import** | Drop zone · preview table · match summary (`27 exact, 2 fuzzy, 1 unmatched`) · review queue with map picker · Confirm |
| **Landlords** | List + editor for the manually authored insights |
| **Edit drawer** | Opens over any entity. Every field editable. Photo upload for spaces. |

---

## 6. Stack

| Layer | Choice |
|---|---|
| App | Next.js 15 + TypeScript, deployed on Vercel |
| Map | MapLibre GL + deck.gl (`PolygonLayer` extruded for buildings, second layer for floor bands) |
| Geometry | NYC Open Data Building Footprints, pre-processed to PMTiles for Midtown + Midtown South |
| Basemap | Self-hosted Protomaps PMTiles (free, no API key, no rate limit) |
| Database | Neon Postgres + PostGIS |
| Photos | Vercel Blob |
| Geocoding | NYC Geosearch API (free, keyless) |
| CSV parsing | PapaParse, in-browser |
| Auth | **None.** Public URL. |

**Why no separate static bundle in v1:** the earlier plan called for shipping data as a static file for sub-200ms clicks. With ~50 spaces across 2 submarkets the whole dataset is under 100 KB — it loads into memory at page load and every click, filter, and radius query is instant with zero network. The static-bundle machinery only becomes necessary at all-Manhattan scale.

---

## 7. Build order

| Phase | Deliverable | Depends on |
|---|---|---|
| 0 | Repo scaffold, schema migrations, sample CSVs committed | — |
| 1 | CSV parser + all field-level parse rules, unit-tested against both sample sheets | 0 |
| 2 | Address→BIN matcher + PLUTO/footprint join + confidence flags | 1 |
| 3 | Tile pipeline: footprints → PMTiles for Midtown + Midtown South; basemap | — (parallel) |
| 4 | 3D map render, buildings extruded, highlight layer | 3 |
| 5 | Floor-band geometry + click targeting | 4, 2 |
| 6 | Building profile + space detail + tenants panel | 2 |
| 7 | Import UI: drop zone, preview, review queue with map picker | 1, 2 |
| 8 | Edit drawer for every entity + photo upload to Blob | 6 |
| 9 | Filter rail + viewport-synced sidebar | 4, 6 |
| 10 | Compare tray + side-by-side view + shareable URL | 6 |
| 11 | Radius comps | 4, 9 |
| 12 | Landlord profiles + seed CSV + editor | 6 |
| 13 | Deploy, seed with both sample sheets, polish for demo | all |

Phases 1, 3, and 6 run in parallel. 2 and 5 are the critical path.

---

## 8. What is deliberately not in v1

| Excluded | Why |
|---|---|
| Authentication | Explicitly descoped. See risk note below. |
| Placer.ai | Descoped. |
| Salesforce integration | Tenants come from CSV/manual entry now; the `tenants.source` field is already there for the swap. |
| Landlord economics (breakeven, opex) | Sensitive. Not going in a link-anyone-can-open app. |
| Transit walk times | P1. |
| Photorealistic mode | P1. |
| All of Manhattan | Midtown + Midtown South only. Adding submarkets is a tile-clip change, not a rewrite. |

---

## 9. Risks, stated plainly

| Risk | Assessment |
|---|---|
| **No auth on a public URL** | You asked for this and it's the right call for a prototype — a login screen in front of a partner demo is friction with no upside. But: the URL is guessable-adjacent and search engines can find it. Mitigation in v1: a `noindex` header, a randomised deployment URL, and **no landlord economics or confidential tenant data in the dataset**. Before this ever holds sensitive data, auth goes in. |
| Floor-band vertical accuracy | ±1 floor on complex towers. Disclosed above; per-building override available. |
| Agent emails truncated in source sheets | Several are cut off mid-address in the samples (`ethan.silverstein@cushwak`). Flagged in the review queue rather than shown as valid. |
| 2014 massing data | Midtown South was chosen partly because its stock is stable. A handful of Midtown towers may render short or be missing — those get hand-patched from a small override table. |
| Sheet format drift | The parser validates the header row and refuses an import with a clear message rather than importing garbage. |

---

## 10. Cost

| Line | Amount |
|---|---|
| Vercel Pro | already paying |
| Neon | $5–19/mo |
| Vercel Blob (photos) | $1–3/mo |
| Geocoding, footprints, basemap | $0 |
| **New recurring spend** | **~$10–20/mo** |
| Build cost (Claude) | ~$400 one-time, or covered by a Claude Max subscription |
