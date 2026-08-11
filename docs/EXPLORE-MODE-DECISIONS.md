# Explore mode — decision log

Every judgement call made during the Explore mode build, written down as it
was made.

**Append to this file the moment a decision is made.** Not at the end of a
sprint, not at the end of the run. A run this long loses context, and a log
reconstructed from memory afterwards is a fiction — it will be confidently
wrong about the reasoning, which is the only part worth keeping.

The last column is the one that matters. It is what lets the owner overturn a
decision without having to reverse-engineer it first: what it would cost, and
what he would get instead. A row without a real answer there is not finished.

Rules for this file:

| | |
|---|---|
| One row per decision | Not per commit, not per sprint |
| Small decisions belong here too | The point is a complete record, not a highlights reel |
| Escalated decisions belong here | With what the owner said, so the reasoning survives |
| Never edit a row after the fact | Add a new row that supersedes it, and say so |

---

## Decisions

| # | Sprint | Decision | Why | What changes if the owner disagrees |
|---|---|---|---|---|
| 1 | 0 | Work on `claude/spaces-lab`, as instructed, not on the session's default branch `claude/spaces-lab-lk3n7u` | The owner named the branch explicitly and it is the one Vercel builds a preview from. Both branches pointed at the same commit when the run started, so nothing was lost | Nothing. `git push -u origin claude/spaces-lab-lk3n7u` from the same commits, one command |
| 2 | 0 | Add a development fixture dataset — `fixtures/dev-buildings.json`, served by `/api/buildings` **only** when `SPACES_FIXTURE_DB=1` | This container has no `DATABASE_URL` and no way to get one. Without a fixture the map is empty, no screenshot exists, and none of the seven existing browser harnesses can run — which would make every visual kill criterion in the plan unverifiable | Delete `src/lib/dev-fixture.ts`, the four-line guard in `/api/buildings`, `fixtures/` and `scripts/make-dev-fixture.ts`: ~10 minutes. Cost of doing so is that this branch can no longer be verified anywhere without a database |
| 3 | 0 | Geometry, BINs, heights, floor counts and years in the fixture are real NYC Open Data. Availability and tenancy rows are invented, and every one carries `FIXTURE — synthetic development data` in its own notes | The plan forbids inventing *product* data. Development scaffolding that never reaches production and is labelled in every row is a different thing, and the alternative was no visual verification at all for the whole run | Point the fixture generator at a read-only copy of the real database instead: ~1 hour, and needs a connection string this container does not have |
| 4 | 0 | The fixture is a fallback for the **flag**, never for a database failure. A missing or broken `DATABASE_URL` still errors exactly as it does today | A broker must never be shown invented availability because a query timed out. Silent fallback is how that happens | None available — this one is not worth overturning |
| 5 | 0 | Baseline recorded as 100 passing / 7 failing browser checks before any Explore code was written. The 7 are `verify-add-by-hand` ×5 (needs database writes) and `verify-map-chrome` ×2 (needs a second tower to land under a projected screen point) | A regression detector needs a known-good starting count. Reporting "7 failures" at the end without this baseline would look like damage caused by this work | Nothing to change; this is a measurement, not a choice |
| 6 | 0 | `three` 0.185.1 (MIT) as the only new runtime dependency | The plan settles three.js. MIT is permissive; the module graph actually imported is roughly 170 KB gzipped, well inside the 5 MB load budget | Nothing else in the plan works without it |
| 7 | 1 | The three.js scene is **metres**, `+X` east `+Y` north `+Z` up, bridged to Mercator by one translate-and-scale in the layer | A mullion is 4e-9 Mercator units, which is past a 32-bit float's resolution. Every shader that wants a distance in metres would otherwise have to undo the projection first | Nothing to change — this is the standard bridge. Moving the anchor is what costs: it is fixed for the layer's life because it is the origin every vertex is relative to |
| 8 | 1 | Camera position derived from MapLibre's **public** accessors (`getCenter`/`getZoom`/`getPitch`/`getBearing`) using its own camera model, not read off `map.transform` | `transform` is not in the published type surface and has changed shape between versions. This project has already been bitten once by building on an internal | Read `map.transform.getCameraPosition()` instead: 5 lines, and it re-couples us to a private field |
| 9 | 1 | three.js **colour management off** for Explore mode | Since r152 `new Color('#8FB4E4')` is converted sRGB→linear while `new Color(0.9,0.9,0.9)` is not. Explore mixes both — sky from the atmosphere presets as hex, stone as numbers — so half the palette was silently a stop and a half dark. The city rendered slate blue and every individual number was correct | Turn management on and convert the numeric colours instead: ~1 hour, same result, more places to get it wrong |
| 10 | 1 | Explore renders **display-referred**: no tone mapping, no sRGB encode | This renderer writes into MapLibre's own drawing buffer and composites under deck.gl, and both write display values with no encode step. Explore has to live in their colour space, not its own | Adding a tone-mapped pass means re-grading deck.gl's bands to match: half a day, and the two modes would then differ in how loud Goldenrod looks |
| 11 | 1 | In Explore mode deck.gl draws **only what belongs on top of the world** — bands (invisible, for picking), name-plates, transit, radius. The ground, the massing, the roofs and the floor lines all move to three.js | deck.gl's overlay is a separate canvas composited above MapLibre's, so anything opaque it draws paints over the three.js city entirely. This is not a preference, it is what the compositing allows | Switch the deck.gl overlay to `interleaved: true` so both share one buffer: ~1 day, and it changes the flat map's render path, which is the thing that must not change |
| 12 | 1 | The buildings layer and the bands layer stay in deck.gl in Explore mode, drawn **fully transparent**, purely to keep them clickable | Picking runs in its own framebuffer and is indifferent to alpha, so every popup, fly-to, hover and Compare behaviour carries over with no changes in either mode. Rebuilding picking as a three.js raycast would be a second implementation of a solved problem | Raycast in three.js and delete the invisible layers: ~1 day, plus re-testing every click path the flat map already proves |
| 13 | 1 | The **visible** availability bands are drawn in three.js, from the same `computeBands()` the flat map calls | With them on deck.gl's canvas every band showed all four sides at once and read as a yellow wireframe box floating beside the tower rather than a stripe on it. That is availability getting *less* legible, which fails the one rule. Same maths means the two can never disagree about a floor | Move them back and accept the floating look: one line. Not recommended — this was the single biggest legibility win in sprint 1 |
| 14 | 1 | A band's collar is taken from the **massing's width at that height**, not the ground footprint (`lib/explore/profile.ts`) | This is §5's argument as code. On a stepped tower a collar drawn on the plot hangs in mid-air above the first setback. The flat map is unaffected: it draws a plain prism, where the footprint is the answer at every height | Drop `profile.ts` and pass the footprint through: 10 minutes, and every band above a setback floats again |
| 15 | 1 | Explore mode's city is **colourless** — colour-by-rent applies to the flat map's massing only | The art direction is explicit that availability, client space and the selection are the only saturated things. A city tinted by rent would be competing with the bands everywhere at once | Tint the stone by rent mode: ~2 hours. It directly weakens the one rule, so it should be a deliberate choice rather than a default |
| 16 | 1 | Glass reflectance is 34% face-on rather than the textbook 4% | A curtain wall is mostly glass, so whatever the glass does the building does. At 4% with a tinted pane the city came out dark slate — striking, and the exact opposite of the brief. Coated architectural glazing really is near a third | Lower it and the city darkens; a dark city makes every lit window compete with the bands |
| 17 | 1 | The harness judges "availability leads" on **chroma**, not brightness | A near-white city in sunlight is legitimately brighter than `#FFB600`. Asserting on brightness would force a grey city and contradict the art direction. What makes a band lead is being the only saturated thing in the frame | Assert on brightness instead and the city has to go grey: the measurement change is 5 minutes, the art direction change is the whole look |
| 18 | 1 | Every setback step gets its own lid, not just the topmost | Capping only the top left a hole at each setback you could see the sky through. On screen it read as the tower coming apart rather than as a missing face, which is why only a screenshot found it | None — this was a bug, not a choice |
| 19 | 2 | `ExploreLayer.projectToScreen` and `.budget` are exposed, and the layer is put on `window.__explore` | Sprint 2's kill criterion is that bands and facades must not disagree about a floor, and that can only be proved by projecting a floor to a pixel and looking at it. A unit test would check the same arithmetic twice | Delete both and the alignment check becomes an eyeball: 10 minutes to remove, and the project loses its only mechanical guard on the thing §5 is about |
| 20 | 2 | The alignment probe is a **storey-tall strip across the near facade**, not a point | A point at the centroid lands a hundred pixels off the band on the near wall; a point at a footprint corner misses a band that has stepped inward above a setback. Both are true facts about geometry and neither is the question, which is purely vertical | None — three cheaper probes were each wrong in a different way |
| 21 | 2 | Projection rejects points with `w <= 0` | A point behind the camera divides to a perfectly plausible on-screen pixel. The harness probed it, found no band, and reported floor 63 broken when it was simply above the top of the frame. `Vector3.applyMatrix4` does that divide silently | None — this was a real bug in the projection helper |
| 22 | 2 | The context city is **one merged mesh**, not one per building | At forty thousand footprints the draw-call budget binds long before the triangle budget: forty thousand meshes is forty thousand state changes a frame against a budget of 1,000. Measured: the whole visible city is 151,179 triangles in **one** call | Split it for per-building culling: ~half a day, and it buys nothing until a single viewport holds more than about 2M triangles, which it does not |
| 23 | 2 | Budget measured, not asserted: **151,179 triangles and 19 draw calls** for the whole visible city with Explore on | §9 asks for it to be validated in sprint 2. It is 7.6% of the triangle budget and 1.9% of the draw-call budget, so the room for glass, interiors and street life is real rather than hoped for | Nothing — this is a measurement |
| 24 | 2 | Frame time is reported as "not pathological", with the reason, rather than as a 60 fps claim | The harness runs on SwiftShader in a container, one to two orders of magnitude slower than a broker's laptop. A 60 fps assertion here would either fail always or be meaningless | Run the harness on a machine with a GPU and tighten the threshold: a config change, but it needs hardware this container does not have |

---

## Superseded

Move nothing here. Add a new row above that says "supersedes #n", and note the
number here with a one-line reason, so the trail stays readable.

| # | Superseded by | Why |
|---|---|---|
