# Explore mode — the plan

A brief for a fresh Claude Code session. You will have no memory of the
conversation that produced this. Everything you need is here.

---

## 0. Read this first

Five rules. Breaking any of them fails the work regardless of how good the
result looks.

| Rule | Why |
|---|---|
| **Work only on `claude/spaces-lab`.** Never push to `main`. | The owner merges when and if he wants. This is a lab. |
| **Never remove or degrade the existing flat map.** | It is the working tool. Explore is a second mode, reached by a button, and `/map` must behave exactly as it does today when Explore is off. |
| **A Goldenrod band on the 14th floor stays the loudest thing on screen.** | The one rule of this product. Every item below competes with it. Any phase that dims availability is a regression, however good it looks. |
| **Nothing is hand-authored per building.** | Detail comes from data — footprint, height, floor count, year built. A treatment that needs an artist per tower cannot scale to "every building we ever add". Two named heroes are the only exception, and their exception is data too (§5). |
| **Read `docs/MAP-REALISM-BRIEF.md` before writing shader code.** | It carries the traps this codebase has already fallen into three times — chief among them: any shader injecting into `DECKGL_FILTER_COLOR` must guard with `!bool(picking.isActive)` or building clicks silently break, and the GLSL preprocessor only evaluates *integer* constant expressions. |

---

## 1. What this is

A second mode on `/map` in which Manhattan is a real-time 3D model you can move
through freely, rather than a map you look down at:

- buildings with real facades — window grids, mullions, spandrels, glass that
  reflects the sky
- roofs with their existing furniture as actual geometry
- free camera, and a first-person walk at street level
- rooms visible through the glass
- one walkable floor plate inside a space
- later: cars on the real street network, people on the real pavements

It is not a game and it is not photoreal. The closest existing thing is
**VU.CITY** — a planning-grade digital twin — and that is the reference.

The thing that makes it worth building is not the 3D. It is that **the
availability data drives it**: the 14th floor lights up because a landlord
published it this morning, and you can walk up to the window of that floor.
Nobody has that combination on the open web.

---

## 2. Art direction

**VU.CITY.** Take it literally.

| | |
|---|---|
| Massing | Near-white to light warm grey. Neutral, matte, architectural |
| Glass | Genuinely reflective — sky cubemap, Fresnel edge, slight tint. The only shiny thing in the world |
| Streets | Clean. Pale roadbed, crisp kerbs, no grime, no decals |
| Lighting | Honest sun for the hour, real shadows, soft ambient. Already solved in `atmosphere.ts` |
| Colour | **The city is almost colourless on purpose.** Goldenrod availability, teal client space, and the selection are the only saturated things in the frame |
| Clutter | None. No signage, no bins, no chatter |

That last row is the whole art direction. The neutrality is not taste, it is
what protects the one rule: on a near-white city, a Goldenrod band screams.

**Not:** Cities: Skylines saturation, cartoon proportions, photoreal
photogrammetry, or any texture that reads as photography.

---

## 3. Architecture

**three.js, sharing MapLibre's WebGL context, beside deck.gl.**

```
MapLibre GL          basemap, camera, projection            (unchanged)
  └─ custom layer → three.js scene    buildings, glass, roofs, interiors,
  │                                    cars, people                   NEW
  └─ MapboxOverlay → deck.gl          availability bands, walk lines,
                                       transit, radius, labels    (unchanged)
```

MapLibre's custom-layer hook hands you the GL context and the projection
matrix each frame; three.js renders into the same context with the same
camera, so a deck.gl band and a three.js facade agree about where the 14th
floor is.

**Why not the alternatives** — this was decided, do not relitigate it:

| | Verdict |
|---|---|
| deck.gl alone | Cannot do this. No scene graph, one lighting model, no glTF/material pipeline |
| Unity WebGL | 40–80 MB download, and the whole React UI — filters, cards, provenance — would have to be rebuilt inside it |
| Unreal + Pixel Streaming | ~$0.50–2.00 per concurrent viewer-hour, server GPUs, latency. It stops being a link in an email |
| **three.js** | Keeps React, the data, the popups, the provenance. You write the systems, which is the price |

Add `three` as a dependency. Do not add a physics engine — a capsule against
extruded footprints is all the collision this needs.

---

## 4. Which buildings get the treatment

A rule, not a list:

> **Any building we hold a record for gets the full treatment. Everything else
> is context massing.**

That means any building with an availability, a tenant, a Cresa client, or a
landlord record — from any source, now or later, one at a time or in bulk.
Today that is 73 buildings and 312 spaces. It must be true of building 400
with no code change.

Everything else in view — roughly 40,000 footprints from
`useCityContext.ts` — stays as it is now: quiet grey massing, never clickable,
never labelled. It is the skyline, not the subject.

Implement this as a derived predicate over the loaded buildings, in one place,
so it cannot drift.

---

## 5. The honest hard part: silhouette

**Extruding a footprint to its roof height gives you a box.** The Empire State
Building has setbacks at floors 6, 30, 72 and 86 plus a spire. One WTC tapers
and twists from a square base to a square rotated 45°. Neither is anywhere in
the data we hold, so "looks exactly like the building" is *not reachable by
extrusion* — and the two named heroes are the two worst cases in the city.

This is the gap between the promise and the delivery. Address it explicitly:

1. **Evaluate NYC's 3-D Building Model first.** DoITT publishes a multipatch
   LOD2 massing model of the whole city with roof structures and setbacks. If
   it loads and aligns, it solves this automatically for every building and
   most of this section disappears. **Do this before writing any facade code**
   — it changes the design.
2. **If that fails, store a massing profile per building.** A short stack of
   `{ heightFt, insetFt, rotationDeg }` steps, in the database, derived once
   and reviewed by eye. Automatic default is a single step (today's box); a
   hero gets four or five. The data path stays uniform.
3. **Never fake it with a texture.** A photographic facade pasted on a box
   fails at exactly the moment someone walks up to it, which is the moment
   this mode exists for.

Hero buildings, in order:

| # | Building | Why |
|---|---|---|
| 1 | **350 Fifth Avenue** — Empire State | Everyone in the room knows instantly if it is wrong |
| 2 | **285 Fulton Street** — One WTC | The hardest silhouette in the city. If the pipeline does this it does anything |
| 3 | **One Battery Park Plaza** | The control. An ordinary 1971 FiDi tower that must look right with **no** hand-holding — this is what proves the automatic path |

---

## 6. What already exists — reuse it, do not rebuild it

| Asset | Where | Use for |
|---|---|---|
| Footprints, roof heights, floor counts, year built | database; 73/73 have footprint and height, 59 floors, 73 year built | Base geometry, window grids, style selection |
| Facade shader with floor lines | `src/components/map/facade.ts` | The starting point for the window grid. **Read its picking guard first** |
| Roofscape: parapets, plant, water tanks, crowns — BIN-seeded, deterministic | `src/components/map/roofs.ts` | Promote from proxy geometry to real meshes |
| Streets, kerbs, pavements, parks, water, trees | `src/components/map/ground.ts`, `useStreetscape.ts` | The ground plane, and the surfaces people and cars move on |
| **Street routing graph** | `src/lib/walk-network.ts` | Car and pedestrian agents run on this. It already exists — do not build a road network |
| Sun position, sky, haze by hour | `src/components/map/atmosphere.ts` | Lighting and the glass environment map |
| Floor → height maths | `src/lib/floor-bands.ts` | Where a window band sits; where an interior floor plate sits |
| City context massing | `src/components/map/useCityContext.ts` | The 40k-building skyline |
| Google photoreal tiles integration | `src/components/map/photoreal.ts` | **Reference only** — a way to check a hero's silhouette against reality |
| Colour system + user overrides | `src/components/map/colors.ts` | Availability colours must keep working in 3D |
| Store, modes, UI state | `src/lib/store.ts` | Add `mapMode: 'flat' \| 'explore'` here |
| Browser verification harnesses | `scripts/verify-*.mjs`, `scripts/harness.mjs` | The project's convention: prove it in a real browser, not only in unit tests |

Floor plan PDFs are linked from SL Green and Durst listings. They are a real
source for hero interiors later. Nobody else has bothered to use them.

---

## 7. Track A — Explore mode

Each phase has a kill criterion. If it trips, stop and report rather than
pressing on.

| Phase | Deliverable | Kill criterion |
|---|---|---|
| **0. Spike** | ONE building — Empire State — full treatment, free camera, walk up to it. Throwaway code is fine | It does not read as VU.CITY. Stop; the art direction is wrong and no amount of phase 2 fixes it |
| **1. Renderer** | three.js in MapLibre's context; deck.gl still drawing bands correctly over it | Bands and facades disagree about where a floor is, or frame rate collapses on 73 buildings |
| **2. Massing** | §5 resolved. Setbacks on the three heroes, automatic path for the rest | Heroes still read as boxes |
| **3. Facades** | Procedural windows, mullions, spandrels, reflective glass, across all eligible buildings | Availability bands stop being the loudest thing |
| **4. Roofs** | `roofs.ts` promoted to real geometry | — |
| **5. Movement** | Free camera with no pitch cap; first-person walk; capsule collision on footprints | Walking feels bad — it will need iteration, budget for it |
| **6. Interiors** | Interior mapping behind the glass; ONE walkable floor plate on a hero, entered from its band | Interior mapping reads as a texture rather than a room |
| **7. Life** | Cars on the street graph, then people on the pavements. Instanced | Frame budget |

**Interior mapping** (phase 6) is the technique to look up if it is unfamiliar:
a parallax shader that draws a convincing room behind a window with zero
geometry. It is how open-world games fill a city with lit offices. It is the
single highest-payoff item on this list — and it is what makes glass worth
having.

---

## 8. Track B — the flat map gets sky, cars and people

The existing 2D-ish map also gets a clearer, more realistic skyline, plus cars
and people. It shares the pipeline with Track A, so build it second and inherit.

It is **not** free, and the plan should not pretend otherwise:

| Item | Real cost |
|---|---|
| People | Genuinely cheap. Instanced billboards near, dots far, on existing pavement polygons |
| Cars | Moderate. Instanced meshes as agents on the existing walk graph. No traffic simulation — timed paths, stop at junctions |
| "Great clear realistic skyline" | **Not cheap.** This is the same massing and facade work as Track A phases 2–3, applied to context buildings at lower detail. It is cheap only *because* Track A already paid for it |

Track B lands on `/map` as it exists today. It must survive the existing
browser suites — `verify-picking`, `verify-sources`, `verify-map-chrome`,
`verify-compare`, `verify-occupancy`, `verify-snapshot`, `verify-add-by-hand` —
unchanged.

---

## 9. Performance budget

Validate in phase 1 and hold to it. If a phase cannot stay inside, cut the
phase, not the budget.

| | Target |
|---|---|
| Frame rate | 60 fps at desk, ≥30 fps on a laptop on battery |
| Triangles | ≤ 2M in view |
| Draw calls | ≤ 1,000 — instance aggressively |
| Initial load | ≤ 5 MB over today's bundle |
| Detailed buildings in view | 73 today, must hold at 400 |

LOD is not optional past phase 3: shader facades near, flat massing far, and a
tile-based stream for the context city.

---

## 10. Verification

This project's convention, and it is not negotiable: **unit tests for maths,
a real browser for anything you can see.** There is a documented history here
of a click test that passed while the feature was broken.

- Unit-test the pure parts: massing profiles, window-grid maths, agent
  pathing on the graph.
- Add `scripts/verify-explore.mjs` on the pattern of the existing harnesses.
  It must assert, at minimum: the flat map still works with Explore off; a
  band and its facade agree on floor position; the FPS camera cannot walk
  through a building; frame time stays inside budget.
- Screenshot every phase. The kill criteria above are visual, so the evidence
  has to be visual.

---

## 11. Non-goals

Say no to these out loud, so they do not creep in:

- Photorealism, and Google photoreal tiles as the *look* (reference only)
- Traffic simulation, pedestrian AI, day/night crowd behaviour
- Modelling interiors per space by hand
- Weather, seasons, rain
- Multiplayer, avatars, VR
- Any of it on `main`

---

## 12. The one open question

Nothing in here is worth doing if the availability data stops leading. Before
each phase ships, take one screenshot from a broker's eye height and ask: **is
the 14th floor still the first thing I see?** If the answer is no, the phase is
not done, whatever else is true of it.
