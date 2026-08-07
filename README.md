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
- **Landlord profiles.** Insights, amenities, and portfolio numbers you write yourself, seeded by sheet or typed in.

Full detail: **[PLAN.md](./PLAN.md)**

---

## Current status

| | |
|---|---|
| Plan | ✅ Complete |
| Build | Not started |
| Coverage | Midtown + Midtown South |
| Sample data | `data/samples/` — two real weekly sheets |

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

> **30 rows imported — 27 matched exactly, 2 need review, 1 unmatched**

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

No terminal required for any of it.

| Step | Where | What |
|---|---|---|
| 1 | Neon console | Create a project. Copy the connection string. |
| 2 | Vercel dashboard | Import this repository as a new project. |
| 3 | Vercel → Settings → Environment Variables | Paste the values from the table below. |
| 4 | Vercel → Storage | Add a Blob store (for space photos). The token is injected automatically. |
| 5 | Vercel → Deployments | Deploy. |
| 6 | The app | Open the URL, go to **Import**, drag your CSV in. |

### Environment variables

| Name | Value | Where it comes from |
|---|---|---|
| `DATABASE_URL` | Neon pooled connection string | Neon console → Connection Details |
| `DATABASE_URL_UNPOOLED` | Neon direct connection string | Neon console → Connection Details → Direct |
| `BLOB_READ_WRITE_TOKEN` | auto | Injected by Vercel when you add a Blob store |
| `NEXT_PUBLIC_PMTILES_URL` | Blob URL of the building tiles | Set after the tile file is uploaded |
| `NEXT_PUBLIC_BASEMAP_URL` | Blob URL of the basemap tiles | Set after the basemap file is uploaded |
| `NEXT_PUBLIC_MAP_CENTER` | `-73.98,40.75` | Midtown / Midtown South |

Database tables are created automatically on first deploy.

---

## Not in this version

Authentication · Salesforce integration (tenants are CSV or manual for now) · Placer.ai · landlord breakeven and operating-expense figures · transit walk times · photorealistic mode · submarkets beyond Midtown and Midtown South.

---

## Repository

```
PLAN.md              Full build plan — scope, data model, CSV contract, phases, risks
data/samples/        Two real weekly availability sheets, used as test fixtures
3DNYC.MD             Original product brief
```
