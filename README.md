# 3DNYC

An interactive 3D map of Manhattan for office leasing. Upload the weekly availability sheet, and every building with new space lights up. Click a building to see its available floors, the spaces on them, current tenants, and landlord insights. Compare spaces side by side across buildings. Run comps within a radius.

Built to be used live in a tenant meeting.

> **Prototype.** No login — anyone with the link can open it. Intentional for partner demos. Do not put confidential landlord economics in it.

---

## What it does

- **Drop a CSV → the map updates.** The weekly "Space Added This Week" sheet imports as-is, no reformatting.
- **Or add one by hand.** A single building, or a single floor, from its address — no spreadsheet. Through the same matcher, the same floor parser and the same tables, so a hand-added building is not a lesser kind of building. A building may exist with nothing available in it: you know the tower before you know what is free in it.
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
- **Filter on anything** in the sheet: lease expiration, asking rent range, SF, floor, class, direct vs sublet, submarket, leasing company, date added. One click for *Added this week* or *Added in 3 months*.
- **Replace the market, or update it.** A weekly sheet merges. A full market extract can be committed as the whole inventory, retiring everything it does not carry — kept in the record with its photos and notes, not deleted.
- **Search by who is in the building.** Nobody remembers 100 Park Avenue; everybody remembers who is in it. A tenant name or industry finds the tower.
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

### Three kinds of band, and where tenants come from

The map's subject is space on the market. It now also carries who is in the
rest of the building, because "what else is in that tower, and when does it
roll" is the question that follows every availability.

| Band | What it is | Where it comes from |
|---|---|---|
| **Available** | Space on the market | Your weekly availability sheet |
| **Cresa clients** | Our clients and the space they hold | The client CSV, or a Salesforce record typed as a client |
| **Occupied** | Everyone else in the building, and prospects | A tenant roster, a Salesforce export, or the API sync |

All three are one `tenants` table with a `relationship` column, not three
tables, because they are the same fact about the world — this company is on
these floors — differing only in our relationship to it. A prospect becomes a
client without moving.

**Availability cannot be switched off.** The other two are toggled from the
legend and default to off. A tower has one availability and forty tenants, so
the hierarchy is enforced four ways at once rather than by colour alone:
Goldenrod at full opacity in the thickest stripe standing furthest off the
facade, teal for a client in a thinner one, and a translucent tint for
everyone else that reads as tone on the building rather than as a mark. A
tenancy across floors 7–14 is drawn as **one** block, not eight stripes — it is
one tenancy, and eight stripes stacked up a facade become indistinguishable
from the building's own floor lines.

A tenancy whose floors cannot be read as numbers — "Ground", "PH", "Entire
building" — is imported, listed on the building profile, and **not drawn**.
Guessing that "Ground" means 1 would put a band on a floor on the strength of
a guess. The building profile marks those rows "not on the map", which is the
one place anyone would find out why a tenancy they can see in the table is not
on the tower.

Occupancy carries through the rest of the product too: tenant names and
industries are searchable, the building profile shows each tenancy's
relationship in the same colour the map uses, and Compare gains an **Occupancy**
section — our clients in each building, who else is there, and how many leases
roll inside twelve months. That last row is scored the opposite way to every
other one on the table: more is better, because a lease about to roll is an
opportunity rather than a defect.

Three ways in, in order of how much setup they need:

| | |
|---|---|
| **Client CSV** | `data/samples/cresa-clients-template.csv`. Every row is a client. |
| **Tenant roster / Salesforce export** | `data/samples/salesforce-tenants-template.csv`. A `Type` column decides occupier / prospect / client; Salesforce record ids make a re-import an update rather than a duplicate. |
| **Salesforce API** | Three environment variables and a sync button. |

The API sync is a convenience, not the product: it converges on the same rows
the CSV importer produces, so both share one address matcher, one floor parser
and one upsert, and neither can drift into being the better-behaved path. Set
`SALESFORCE_INSTANCE_URL`, `SALESFORCE_CLIENT_ID` and `SALESFORCE_CLIENT_SECRET`
(a connected app with the client-credentials flow and a run-as user). Because
every org names its property fields differently, `SALESFORCE_SOQL` replaces the
query outright and `SALESFORCE_FIELD_MAP` remaps our names to yours. **Run
"Check without writing" first** — it runs the query and the mapping and reports
what it would write, which is much better than finding out afterwards that
every row mapped to "no address".

One rule the sync will not bend: an unrecognised account type maps to
*occupier*, never to *client*. A teal band tells a room that a company is ours,
and being wrong in that direction is the expensive mistake.

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
| The same, loaded by the landlord loader | The landlord's own listing page, by name and date, with a link straight to it |
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

### The map opens as a map

Both rails are closed and the basemap is light. Everything is one press away —
a large **Filters** button top-left, a large **Spaces** button top-right, both
carrying a count so the button says what is behind it. The tool stack down the
right edge is open, and folds away if you want the edge back.

This is not minimalism for its own sake. A filter rail down one side and a
results list down the other leaves about half the window for the thing everyone
in the meeting is actually looking at, and the first thing a broker did on
opening it was collapse both by hand. Dark was the default on the argument that
these maps are shown in dim rooms on projectors — true of some meetings and not
of the laptop where the work happens.

Four more things follow from the same idea:

- **The legend folds**, whole or in parts. "Bands on the towers" has its own
  toggle, because once you know gold means available you stop reading it.
- **Every tool explains itself.** Hovering one opens a pill with its name and a
  sentence. Fifteen unlabelled icons is a puzzle, and a `title` attribute is
  invisible on a projector and absent on a touch screen.
- **Cards drag, and pin.** Any card opened from the map — a building, a floor,
  a tenancy, a station — can be dragged by its header and pinned. A pinned card
  survives the click that opens the next one, so two floors in the same tower,
  or the same floor in two towers, can sit side by side. Exactly one card is
  ever unpinned; that one closes on a click away, so clicking around a tower
  never leaves a trail.
- **The colours can be changed** — the band for available space, for clients,
  for occupied floors, the selected building, the selected floor, and both ends
  of the colour ramp. See below for what that deliberately does not include.
- **The camera tilts all the way to the pavement.** The angle steps through a
  ladder from straight down to 85°, which is standing in the road looking up a
  facade — the view that answers whether the 14th floor has light or faces a
  wall. Both tilt buttons wrap, so neither is ever dead. 85° is MapLibre's own
  ceiling: past it the horizon is behind the camera and there is nothing to
  draw.
- **One big way back.** Once the camera has moved, a wide **Reset the view**
  button appears at the bottom centre and returns the angle, the bearing and
  the frame together. The 36-pixel compass in the tool stack does the same
  thing, and nobody who is lost at 85° finds it.

### The one rule

A Goldenrod band on the 14th floor is the loudest thing on screen. Everything
above serves that and yields to it. Concretely: distance haze is applied at
full strength to scenery, at 42% to the buildings that carry data, and **not at
all** to the availability bands, so a band is at full contrast at any distance;
roof furniture takes the colour of the building it stands on rather than
introducing a second colour at the top of a silhouette; and the Compare
launcher on the map canvas is deliberately not Goldenrod, because on the map
Goldenrod means available space and nothing else — as are the source markers
and the two rail buttons, for the same reason and with a test to hold it.

The colour controls hand over the **hue** and nothing else. Opacity, stripe
thickness and draw order are what actually enforce this rule — availability is
drawn last, thickest and at full opacity — so a recoloured band still arrives
loudest. That is the difference between letting someone adapt the map to their
room and letting them break it.

---

## Current status

| | |
|---|---|
| Plan | Complete — [PLAN.md](./PLAN.md) |
| Build | Complete and deployable |
| Production build | Passing |
| Tests | 390 passing — parser against both real sheets, plus transit, photoreal gating, streetscape and label layout, roofscape geometry, atmosphere and both shaders' picking guards, entrance placement, street-network routing, station deduplication, the fallback geocoder's address normalisation, the compare set's lifecycle, the source resolver's field-by-field answers, how people write floors, the occupancy bands' hierarchy, the Salesforce field mapping, and two guards that hold rules a comment cannot: that no UI file references a named agent, and that every dismiss-on-outside-click surface exempts the source popover |
| Coverage | 53 buildings, 312 availabilities, read from four landlords' own pages |

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
| `node scripts/verify-add-by-hand.mjs <dir>` | An address already on the map is recognised **before** anything is created and the create button stays disabled; a new one reports the BIN it resolved to; an unreal one is refused with a reason; and a building's own page offers the same form without asking for an address. |
| `node scripts/verify-occupancy.mjs <dir>` | The three band kinds are listed, filterable and clickable on the real map; availability cannot be switched off; a tenant name finds its building; Compare answers "what else is in that tower"; and an unconfigured Salesforce fails with a remedy rather than just a failure. |
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

## Replacing the whole market, rather than updating it

The weekly sheet says what **changed**. A full market extract says what
**exists**, and only the second one licenses taking listings off the map.

The commit step has a checkbox for that: *"This sheet is the whole market, not
an update."* Off by default, because getting it backwards in the dangerous
direction — treating a weekly update as the whole market — would retire every
listing the update did not happen to mention. When it is on, the panel tells
you how many listings are on the map right now, before you commit, because
"everything not in this file comes off" means nothing until you know what
everything is.

Retired, not deleted. `is_active` goes false; the row, its photographs, its
notes and its edit history all stay. A space that comes back on the market next
month is the same space, and a broker who remembers showing it should still be
able to find it. It also means a replace run against the wrong file is
recoverable — which a delete would not be.

### Where market-wide availability actually comes from

There is no free, complete, machine-readable source for Manhattan office
availability, and it is worth being precise about why:

- **Scale.** Colliers counted **66.2M SF available in Manhattan in July 2026**,
  around 3,500 individual office listings. That is the size of the answer to
  "every available space in every building".
- **The comprehensive source is licensed.** CoStar's terms prohibit scraping
  and redistribution, and they enforce it — including CFAA suits and a $1M
  settlement with a competitor that systematically copied listings. Any feed
  from CoStar has to arrive through a subscription and its export, not a
  crawler.
- **Landlord sites are partial and rentless.** SL Green — one of the largest
  Manhattan office landlords — publishes roughly 200 availabilities across 32
  buildings with address, floor and SF, and **no asking rent at all**: every
  one reads "Rent: Upon Request".
- **The good space is not public.** The market's own summary: almost none of
  the well-priced space in older or off-market buildings ever reaches a public
  listing site.

So the routes that actually work, in order of coverage:

| Route | Coverage | How it gets in |
|---|---|---|
| CoStar / CompStak export under your subscription | Effectively the whole market | Save as CSV, import with **replace** on |
| **The landlord loader** (below) | Four large landlords, ~310 listings, no rents | `npx tsx scripts/load-landlord-availability.ts` |
| Your own weekly availability sheets | Your inventory, authoritative | The normal import |
| A landlord or brokerage feed you have a relationship with | That landlord's stack | Import, or the by-hand form |

All of them land in the same tables through the same matcher. Nothing in this
repo scrapes a licensed source, and nothing invents a listing: a rent that
cannot be verified is stored as **withheld**, never as a number.

---

## The landlord loader

```bash
npx tsx scripts/load-landlord-availability.ts --dry-run   # look, write nothing
npx tsx scripts/load-landlord-availability.ts             # merge
npx tsx scripts/load-landlord-availability.ts --replace    # this run IS the inventory
```

An owner with an empty floor publishes the floor, the size and a phone number,
because that is how the floor gets leased. That makes a landlord's own page the
best public source there is for the two facts this map is built on — which
floor, and how big.

### What is in it

| Landlord | Page | Listings | Buildings |
|---|---|---|---|
| SL Green Realty Corp. | `slgreen.com/availabilities` | 166 | 23 |
| Rudin Management Company | `rudin.com/availability` | 56 | 11 |
| The Durst Organization | `durst.org/availabilities` | 60 | 8 |
| Empire State Realty Trust | `esrtreit.com/availabilities` | 29 | 10 |

**311 listings across 52 buildings, about 5.2M SF.** For scale, Colliers counts
66.2M SF available across Manhattan — so this is roughly 8% of the market, and
it is the large-landlord, Class-A end of it. It is not "every building in
Manhattan", and the gap is not a bug in the loader: the rest of the market
either does not publish, or publishes only through CoStar.

### Not one of them quotes a rent

Every listing on all four reads *"Upon Request"*. That is how Manhattan office
space is marketed, not a gap in the parser. The rows come in with
`asking_rent_withheld` set, the map's rent colour mode shows them as grey
rather than inventing a position on the scale, and the filter rail's
withheld-rents hint now reads the live proportion — because a checkbox that
would take 312 listings down to one should not be labelled "roughly half".

### What it refuses to do

- **Guess a building.** Several are marketed under a name rather than a number
  — *One Five One*, *5 Grand Central East*. Those resolve through a table in
  `landlord-feeds.ts`, each entry verified against that building's own page on
  the landlord's site. A slug that is not in the table produces no listing at
  all, and the run says which ones it skipped.
- **Stamp a date nobody published.** `date_added` stays null. No page says when
  a space came to market, and the column is part of the spaces natural key, so
  a run date would both invent a fact and re-insert the whole market weekly.
  The consequence is deliberate and worth knowing: **landlord listings do not
  appear under "Added in 3 months"**, because nothing here knows when they were
  added.
- **Replace on a partial run.** Rudin's site returned 503 mid-run while this was
  being built. Replacing on the strength of the other three would have taken all
  56 of their availabilities off the map because a web server had a bad minute,
  and the map would have looked fine. A run with any feed missing merges and
  says so.
- **Overrule a person.** Spaces typed in by hand are never retired, the same
  rule that makes a `manual` field stamp win everywhere else.
- **Be a nuisance.** Every request identifies itself, and each feed waits the
  crawl delay its site asks for — ten seconds for SL Green, which publishes
  `Crawl-delay: 10`. Rudin asks for nothing in `robots.txt` and started
  resetting connections when crawled at two seconds a page, so it waits fifteen.
  None of the four disallows these pages; they are published to be read.

### When a landlord redesigns their site

These are somebody else's templates and they will change without warning. The
failure mode that matters is silent: a parser that returns nothing reads on the
map as *"this landlord has no space available"*, not as *"this is broken"*. So
the loader treats an empty first page as an error and stops, and
`tests/landlord-feeds.test.ts` parses a captured copy of each real page —
chosen for the awkward records, not the tidy ones: a space below street level,
a floor number welded to a wing letter, a size given as a range, a building in
Brooklyn.

Three bugs that pass came out of exactly those:

- A size range is *this floor* to *the largest contiguous block it can join*.
  Taking the high end charged the whole block to every component floor, and
  733 Third Avenue read as 441,625 SF available when barely a quarter is free.
- `5,728 - 5,728` fell through to the plain size parser, which strips
  punctuation — 57,285,728 SF, on a map whose header total had looked plausible
  the run before.
- `Lower Level Suite 1` and `Partial Ground Floor 3` each carry a digit that is
  a unit number. Read as a floor, they put a Goldenrod band on a leased floor
  for space that is under the pavement.

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
src/lib/floor-list.ts     "12-14", "Ground", "Suite 402" → the floors a band can be drawn on
src/lib/tenant-import.ts  Puts a roster of tenancies onto buildings, creating any it has not seen
src/lib/salesforce.ts     The CRM sync, converging on the same rows the CSV importer makes
src/lib/manual-entry.ts   One building or one floor from an address, with the file taken out
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
