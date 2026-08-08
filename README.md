# 3DNYC

An interactive 3D map of Manhattan for office leasing. Upload the weekly availability sheet, and every building with new space lights up. Click a building to see its available floors, the spaces on them, current tenants, and landlord insights. Compare spaces side by side across buildings. Run comps within a radius.

Built to be used live in a tenant meeting.

> **Prototype.** No login — anyone with the link can open it. Intentional for partner demos. Do not put confidential landlord economics in it.

---

## What it does

- **Drop a CSV → the map updates.** The weekly "Space Added This Week" sheet imports as-is, no reformatting.
- **A city we draw ourselves.** The default view needs no API key, no billing and no tile server: our own streets, kerbs, pavements, parks, rivers, street trees, subway entrances and buildings, all from free NYC and MTA open data. See [The city, and where it comes from](#the-city-and-where-it-comes-from).
- **Photorealistic mode.** An optional camera toggle swaps our massing for Google's photographed 3D imagery — real facades and rooftops. Off by default, needs a Google Cloud key, and bills per use; availability bands draw over the imagery so they stay readable. It is an alternative, never a dependency: nothing in the default map relies on it. See SETUP.md.
- **The real city around them.** Every other building in view is drawn from NYC's footprint and roof-height records, so your towers stand inside Manhattan instead of floating in an empty plane. Scenery only — it is never clickable, coloured or labelled.
- **Time of day.** Morning, midday, golden hour and night move the real sun over Manhattan, along with the sky and how far distance fades into haze.
- **Walk routes along real streets.** Select a building with transit on and the dashed lines follow the actual street network to each station, rather than cutting across blocks.
- **Buildings highlight** by asking rent, availability, or class.
- **Floor-level bands.** Zoom into a tower and each available floor is its own highlighted band. Click one for that space.
- **Space detail** with photos you upload yourself.
- **Compare, on the map.** Add a space from one building, another from a different building and floor, a third — side-by-side specs, landlord data included, in a large panel floating over the towers rather than a page takeover. Minimises to a chip and back; dismissing it never empties it; the map's own controls stay reachable underneath. Shareable as a link.
- **No named agents, anywhere.** The weekly sheet carries the listing broker's name and email. Both are imported and stored, and neither is ever displayed — the firm is shown as "Listing broker", the individual is not. Enforced by a test over every UI file, not just by convention.
- **Transit.** Every subway station, bus stop, ferry landing, PATH and rail terminal in view. Select a building and dashed lines run to the nearest few with an estimated walk time and the routes that serve them. Walk time is also a compare column.
- **Radius comps.** Draw a circle around a target building, see every available space inside it.
- **Filter on anything** in the sheet: lease expiration, asking rent range, SF, floor, class, direct vs sublet, submarket, leasing company, date added.
- **Edit everything.** Every imported row is editable in-app. Add photos. Correct a bad address match. Update tenants.
- **Landlord profiles.** Every imported building gets a landlord record created for it automatically, seeded from the city's owner of record and flagged for review — so you edit a landlord rather than create one. Insights, amenities and portfolio numbers are yours to write.
- **Your own logo.** Upload the Cresa mark at `/setup` and position it against live previews of the real navigation bar and footer.

Full detail: **[PLAN.md](./PLAN.md)**

---

## The city, and where it comes from

The map draws every pixel of the world itself. That is deliberate: the view a
broker opens in a meeting must not depend on a key, a bill or a third party's
tile server being up. Every source below is free, keyless and cached
server-side by a snapped bounding box, so the same few Midtown cells are
fetched once and shared.

| What you see | Source |
|---|---|
| Streets, kerbs, pavements, painted street names | NYC Centerline `inkn-q76z` — real surveyed roadbed widths, so an avenue is wide and an alley narrow |
| Rivers, with a shore-to-channel depth gradient | NYC Planimetric Hydrography `pjs3-c3z5` |
| Central Park, Bryant Park, Herald Square and the rest | NYC Parks Properties `enfh-gkve` |
| Individual street trees, sized by trunk diameter | 2015 Street Tree Census `uvpi-gqnh` |
| Subway entrances, stair heads and elevator headhouses | MTA Subway Entrances and Exits 2024 `i9wp-a4ja` |
| Address matching, when Geosearch is down | NYC AddressPoint `uf93-f8nk` |
| Surrounding buildings and roof heights | NYC Building Footprints `5zhs-2jue` |
| Floor counts, year built, owner | MapPLUTO `64uk-42ks` |
| Transit stops and routes | MTA Subway Stations `39hk-dx4f`, Bus Stops `2ucp-7wg5` |

Two things are derived rather than surveyed, because nobody publishes them:

- **What happens at the top of a building.** Parapets, mechanical plant,
  setback crowns and timber water tanks, worked out from the footprint, the
  height and — above all — the year built. A 1913 loft ends in a tank on a
  frame; a 1963 tower ends in a blank slab; a 1983 tower has a low parapet and
  a window-washing mast. Everything is seeded from the building's own BIN, so a
  roof is identical on every reload and every machine.
- **Where a floor sits vertically.** Height ÷ floor count, as before. See
  [Accuracy](#accuracy).

### Where every number comes from

A building profile shows "Class A · 1962 · 41 floors · $88/SF" in one strip, in
one typeface, and it reads as one continuous fact. It is four different kinds
of claim: the class came off a leasing sheet, the year and the floor count off
the city's tax record, and the rent is a broker's asking figure that somebody
here may have retyped this morning. They are not equally reliable and nothing
on screen said so.

So every value that reaches a screen can name its own source. A small circled
**i** sits beside it; clicking it says which sheet, which city dataset, or
which calculation — and, when the value is an estimate rather than a recorded
figure, says that too.

| Kind of value | What the marker says |
|---|---|
| Rent, size, floor, dates, listing broker | The sheet it was imported from, by filename and date |
| Address, building name, class, submarket | Also the sheet — these are how the market describes a building, not what the city records |
| BIN, BBL, coordinates | The city's address index, and whether the match was confirmed |
| Outline, roof height | NYC Building Footprints, with the 2014 survey caveat |
| Floors, year built, area, owner of record | MapPLUTO |
| Station names, routes | MTA open data — except ferry, PATH and rail, which are a hand-kept table and say so |
| Annual rent, floor band position, walk times, view totals | Calculated here, flagged as an estimate |
| Anything corrected in the app | "Corrected here", with the date — the sheet is no longer credited for it |

Three design decisions hold this together.

**Per-field, not per-record.** `spaces` and `buildings` carry a `field_sources`
JSONB column, stamped on write with the field that changed and what changed it.
Only fields whose value actually differs get stamped, compared server-side in
the same statement — saving a form untouched must not turn a sheet figure into
a hand-entered one. Re-importing drops the stamps on the columns the import
overwrites, and leaves the rest.

**Open to what does not exist yet.** The stamp's `kind` is a bare string. A
Salesforce sync writing `{"kind":"salesforce","ref":"006xx"}` needs no schema
change and no new branch; a kind the resolver has never seen still renders as
"recorded by *kind*" rather than silently falling back to "off the sheet",
which would be a lie.

**The marker has to stay quiet.** There are forty of these on a busy screen.
They are drawn in the muted text colour at half opacity, reach full contrast
only on hover or focus, and are **never Goldenrod** — see the rule below. Where
a surface would repeat itself they collapse: the sidebar card carries one
marker rather than six identical ones, the stack table carries its origin once
per row and a cell only speaks up when it disagrees, and a compare row shows
one marker when every column gives the same answer. The Stack Snapshot is a
PNG that gets forwarded and cannot carry an affordance at all, so it prints the
same facts in its footer.

### The one rule

A Goldenrod band on the 14th floor is the loudest thing on screen. Everything
above serves that and yields to it. Concretely: distance haze is applied at
full strength to scenery, at 42% to the buildings that carry data, and **not at
all** to the availability bands, so a band is at full contrast at any distance;
roof furniture takes the colour of the building it stands on rather than
introducing a second colour at the top of a silhouette; and the Compare
launcher on the map canvas is deliberately not Goldenrod, because on the map
Goldenrod means available space and nothing else — as are the source markers,
for the same reason and with a test to hold it.

---

## Current status

| | |
|---|---|
| Plan | Complete — [PLAN.md](./PLAN.md) |
| Build | Complete and deployable |
| Production build | Passing |
| Tests | 254 passing — parser against both real sheets, plus transit, photoreal gating, streetscape and label layout, roofscape geometry, atmosphere and both shaders' picking guards, entrance placement, street-network routing, station deduplication, the fallback geocoder's address normalisation, the compare set's lifecycle, the source resolver's field-by-field answers, and two guards that hold rules a comment cannot: that no UI file references a named agent, and that every dismiss-on-outside-click surface exempts the source popover |
| Coverage | Midtown + Midtown South |

### Verifying it by looking at it

Unit tests cover the geometry and layout maths. They cannot catch a map that
renders wrongly, and this project has been burned once by a click test that
asserted on text also present in the sidebar and so passed while the feature
was broken. So there are scripts that drive the real app in headless Chromium
against the live database, and every assertion is on the thing itself:

| Script | What it proves |
|---|---|
| `node scripts/verify-picking.mjs <dir>` | Building clicks still resolve — at all four times of day and in the busiest frame. Guards the trap below. |
| `node scripts/verify-compare.mjs <dir>` | Compare opens, closes on a map click **without emptying**, reopens with the same spaces, shares and rehydrates. Asserts on `[role="dialog"]`, never on an address. |
| `node scripts/shoot.mjs <dir> <tag>` | Both themes, wide and close, with and without transit. |
| `node scripts/shoot-ground.mjs`, `shoot-atmosphere.mjs`, `shoot-stations.mjs` | The ground plane, the four hours, and the subway entrances. |
| `node scripts/verify-snapshot.mjs <dir>` | Stack Snapshot is produced for real and the PNG inspected: composed at 2x, and no blank filler band. |
| `node scripts/verify-sources.mjs <dir>` | The source markers are reachable on the map, on a station, on the building page and in compare; opening one does **not** close the card it sits on; only one opens at a time; and the sheet, the city and the hand-kept transit table give different answers where they should. |

Clicking a subway station in a headless browser needs the station's real screen
position, not a guess — a few metres of geometry is not something you find by
sweeping the canvas, and trying cost an evening. `verify-sources.mjs` asks the
map: it walks React's fiber tree for the MapLibre instance MapView holds, puts
the stop dead centre at pitch 0 so its height projects onto its own base, and
clicks that pixel. It throws rather than skipping if the instance cannot be
found, because a transit check that quietly never runs is worse than none.
| `node scripts/measure-perf.mjs` | Frame rate across five scenes. |

All of them need the app running: `npx next build && sh scripts/restart-server.sh`.

**Before you touch the importer.** Address resolution has two independent
sources and needs both. Geosearch is the primary and is authoritative, but it
is a single hosted service — when it started returning 503, every row of every
sheet came back "unmatched" and nothing could be imported at all, including
the bundled samples, so a deleted inventory could not be restored. NYC
AddressPoint is the fallback, on the same Socrata infrastructure the rest of
the map already depends on. Geosearch also has a 4-second deadline, because it
has been observed answering correctly but taking 7-9 seconds, which turns a
weekly sheet into a two-minute import.

**The trap worth knowing before you write a shader here.** deck.gl encodes
every object as an exact RGB value and reads it back out of the framebuffer to
resolve a click. Anything injecting into `DECKGL_FILTER_COLOR` must guard with
`!bool(picking.isActive)` or clicks decode to the wrong object or to none —
while the scene still looks perfect. That has broken this map twice. Both
shaders here (the curtain wall in `facade.ts`, distance haze in
`atmosphere.ts`) are guarded, there are unit tests asserting the guard is in
the emitted source, and `verify-picking.mjs` proves it holds at runtime.

A second, quieter trap in the same place: a shader that fails to **compile**
does not throw either. deck.gl logs a link error and the buildings simply do
not draw. `#if 5.0 > 0.5` is the way to cause it — GLSL's preprocessor only
evaluates integer constant expressions — so conditionals of that kind belong
in JavaScript, emitting the block or not. `tests/facade.test.ts` checks the
emitted GLSL for exactly that shape, along with unsubstituted template
placeholders, unbalanced braces, and varyings read but never declared.

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
| Leasing Company | Shown as the listing broker |
| Agent, Agent email | Parsed and stored so the import is not lossy, and **never displayed** — see [Where every number comes from](#where-every-number-comes-from) |
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

Every one of those answers is also on screen, beside the value itself — see
[Where every number comes from](#where-every-number-comes-from). Nothing in
this table is a fact you have to remember; the map will tell you when asked.

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

Optional, and the only part that costs money per use: a Google Cloud key turns
on photorealistic buildings. SETUP.md covers it, including how to restrict the
key so it cannot be spent by anyone who views the page.

Only `DATABASE_URL` is genuinely required. Photos and the detailed basemap are optional —
the app runs and demos without them.

---

## Not in this version

Authentication · Salesforce integration (tenants are CSV or manual for now) · Placer.ai · landlord breakeven and operating-expense figures · submarkets beyond Midtown and Midtown South.

On the map specifically, and worth being plain about:

- **Station headhouses and ferry terminals are not modelled.** Subway
  entrances are. The transit overlay's markers for bus, rail and ferry are
  still abstract posts — they are functional there rather than decorative,
  since they carry the walk times and the click target, so replacing them is a
  separate job from adding scenery.
- **Real cast shadows are still off,** and for the original reasons: deck.gl's
  experimental shadow pass corrupts picking and produces shadow acne across
  decorated facades at city scale. Contact shadows stand in for them.
- **Frame rate on real hardware is unmeasured.** The only GPU available in the
  development sandbox is SwiftShader, a software rasteriser, whose numbers
  varied fourfold between identical runs. They were useful for finding that
  close-zoom cost was layer rebuild rather than rasterisation — which is what
  the caching fixed — but they say nothing about a broker's laptop. The
  structural work (cached derived geometry, viewport culling, level-of-detail
  thresholds by zoom) helps on any renderer.
- **The basemap cannot be checked in the sandbox.** Outbound HTTPS from
  headless Chromium is blocked, so CARTO renders blank locally. Since the
  ground plane now covers it entirely at the zooms that matter, this shows up
  only at very wide zoom.

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
src/lib/streetscape.ts    Streets, water, parks, trees and subway entrances
src/lib/roofscape.ts      What happens at the top of a building, by era
src/components/map/       3D map, floor highlights, radius
src/components/map/ground.ts      The ground plane: streets, kerbs, parks, trees, entrances
src/components/map/roofs.ts       Parapets, plant, crowns and water tanks
src/components/map/atmosphere.ts  Sky, time of day, and the distance-haze shader
src/components/map/facade.ts       Curtain-wall shader — read it before writing another
src/components/map/stations.ts    Modelled stations and their name plates
src/lib/walk-network.ts   Walking routes along the real street network
src/lib/nyc-addresses.ts  Fallback geocoder for when Geosearch is down
src/lib/provenance.ts     Where every value on screen came from — one resolver, no guessing
src/components/ui/SourceInfo.tsx  The circled "i", and the helper every dismissible surface must call
scripts/verify-*.mjs      Behaviour checks that assert on the thing itself
scripts/shoot-*.mjs       Screenshot harnesses for visual verification
src/components/import/    Drop zone, preview, review queue
src/components/detail/    Building profile, space detail, landlord panel
src/components/compare/   Compare panel on the map, and the same table as a modal
src/components/filters/   Filter rail
data/samples/             Two real weekly sheets plus landlord and tenant templates
tests/                    Parser tests run against the real sheets
3DNYC.MD                  Original product brief
```
