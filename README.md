# 3DNYC

An interactive 3D map of Manhattan for office leasing. Upload the weekly availability sheet, and every building with new space lights up. Click a building to see its available floors, the spaces on them, current tenants, and landlord insights. Compare spaces side by side across buildings. Run comps within a radius.

Built to be used live in a tenant meeting.

> **Prototype.** No login — anyone with the link can open it. Intentional for partner demos. Do not put confidential landlord economics in it.

---

## What it does

- **Drop a CSV → the map updates.** The weekly "Space Added This Week" sheet imports as-is, no reformatting.
- **Buildings highlight** by asking rent, availability, or class.
- **Floor-level bands.** Zoom into a tower and each available floor is its own highlighted band. Click one for that space.
- **Space detail** with photos you upload yourself.
- **Compare tray.** Add a space from one building, another from a different building and floor, a third — side-by-side specs, landlord data included. Shareable as a link.
- **Radius comps.** Draw a circle around a target building, see every available space inside it.
- **Filter on anything** in the sheet: lease expiration, asking rent range, SF, floor, class, direct vs sublet, submarket, leasing company, date added.
- **Edit everything.** Every imported row is editable in-app. Add photos. Correct a bad address match. Update tenants.
- **Landlord profiles.** Every imported building gets a landlord record created for it automatically, seeded from the city's owner of record and flagged for review — so you edit a landlord rather than create one. Insights, amenities and portfolio numbers are yours to write.
- **Your own logo.** Upload the Cresa mark at `/setup` and position it against live previews of the real navigation bar and footer.

Full detail: **[PLAN.md](./PLAN.md)**

---

## Current status

| | |
|---|---|
| Plan | Complete — [PLAN.md](./PLAN.md) |
| Build | Complete and deployable |
| Production build | Passing |
| Parser tests | 26 passing against both real sample sheets |
| Coverage | Midtown + Midtown South |

Setup instructions: **[SETUP.md](./SETUP.md)** — about 20 minutes, all browser clicks,
no terminal commands.

### Measured against your two real sheets

| | Midtown | Midtown South |
|---|---|---|
| Listings read | 29 | 14 (1 duplicate collapsed) |
| Unique addresses | 17 | 8 |
| Matched exactly | 15 | 4 |
| Needs one-click confirmation | 2 | 3 |
| Needs a manual map pick | 0 | 1 (`One Soho Sq`) |

Six review decisions on the first import, then zero — every choice is remembered.

---

## The data you upload

The importer reads the existing sheet format with no changes: market label on row 1, blank row 2, headers on row 3, data from row 4.

| Column | Used for |
|---|---|
| Address | Matching the building on the map |
| Date Added | Filtering by recency |
| Floor | Which band highlights on the tower |
| SF | Space size, filters |
| Asking Rent | Colour scale, price filter (`Withheld` handled) |
| Space Use | Office / Off-Ret / Off-Med |
| Type | Direct vs Sublet |
| Occupancy | Available-from date (`Vacant`, `30 Days`, `Sep 2025`) |
| Term | Lease expiration (`Thru Mar 2033`) |
| Leasing Company, Agent, Agent email | Contact card on the space |
| Class | A / B / C filter |
| Submarket Cluster | Grouping and filter |
| Notes | Free text |

Column-by-column parsing rules are in [PLAN.md §4](./PLAN.md#4-csv-contract).

---

## Address matching

Addresses in the sheet are free text; the map needs an exact building. The importer resolves them against NYC's official building records and reports what it found:

> **14 listings read — 4 matched exactly, 3 need confirmation, 1 unmatched, 1 duplicate removed**

Anything not matched exactly goes to a review queue where you click the right building on the map. **That choice is remembered permanently**, so the same address never asks again. After two or three weekly imports the review queue is effectively empty.

Cases already present in the sample data and handled: building names appended after a dash (`60 E 42nd Street - One Grand Central Place`), hyphenated address ranges (`22-30 Little W 12th Street`), abbreviations (`24-32 Union Sq E`), and names with no street number at all (`One Soho Sq` — resolved once by hand, then permanent).

---

## Accuracy

| What | How accurate |
|---|---|
| Which building is highlighted | Exact — matched to NYC's Building Identification Number |
| Which floor is available | Exact — straight from your sheet |
| Where the floor band sits on the tower | Estimated from building height ÷ floor count. Within about one floor on towers with mechanical levels or setbacks. Overridable per building. |

---

## Setup

**[SETUP.md](./SETUP.md)** is the full guide. It takes about 20 minutes and contains no
terminal commands — every step is a click in Neon, Vercel or the app itself.

| Step | Where |
|---|---|
| 1 | Create a database at neon.tech, copy both connection strings |
| 2 | Import this repository at vercel.com |
| 3 | Paste the environment variables (table in SETUP.md step 3) |
| 4 | Add a Blob store in Vercel → Storage, for space photos |
| 5 | Deploy |
| 6 | Open `/setup` in the app and click **Create database tables** |
| 7 | Open `/import` and drag your CSV in |
| 8 | Back at `/setup`, upload the Cresa logo and position it for the nav and footer |
| 9 | Open `/landlords` and write up the landlords the import seeded for you |

Only `DATABASE_URL` is genuinely required. Photos and the detailed basemap are optional —
the app runs and demos without them.

---

## Not in this version

Authentication · Salesforce integration (tenants are CSV or manual for now) · Placer.ai · landlord breakeven and operating-expense figures · transit walk times · photorealistic mode · submarkets beyond Midtown and Midtown South.

---

## Repository

```
SETUP.md                  Click-by-click setup. No terminal commands.
PLAN.md                   Scope, data model, CSV contract, phases, risks
docs/CSV-SPEC.md          Exact column contract for the weekly sheet
docs/LANDLORD-SHEET.md    How to write landlord insights
src/lib/csv-parser.ts     Reads the weekly sheet as produced
src/lib/address-matcher.ts  Resolves addresses to NYC building identifiers
src/lib/footprints.ts     Pulls real building outlines and heights from NYC data
src/lib/floor-bands.ts    Turns "the 45th floor" into a band on the tower
src/components/map/       3D map, floor highlights, radius
src/components/import/    Drop zone, preview, review queue
src/components/detail/    Building profile, space detail, landlord panel
src/components/compare/   Compare tray and side-by-side view
src/components/filters/   Filter rail
data/samples/             Two real weekly sheets plus landlord and tenant templates
tests/                    Parser tests run against the real sheets
3DNYC.MD                  Original product brief
```
