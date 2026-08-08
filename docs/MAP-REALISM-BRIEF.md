# Brief: a stunning 3D Manhattan, built entirely from our own geometry

You are picking up a working product. Read this before touching the map.

---

## 1. What this is

**Cresa Spaces** (repo `3DNY`) is an internal 3D Manhattan map used *live in
tenant meetings* by commercial real-estate brokers. A broker uploads the weekly
availability sheet; every building with new space appears in 3D with its
available floors highlighted; the client asks questions and the broker answers
them on the map without leaving it.

Live: `https://3dny.vercel.app` — no sign-in, deliberately.

The tool has one job, and every visual decision serves it:

> A tenant names a building. You pull it up, show the floors that are actually
> available, and put three better options beside it — with rents, floor sizes,
> transit, and the landlord's real posture. Thirty seconds, across a conference
> table, on a projector.

**The single hierarchy rule, which nothing may break:** a Goldenrod band on the
14th floor is the loudest thing on screen. Beauty that competes with
availability is a regression, not an improvement.

---

## 2. Your mandate

Two things.

### A. Map realism — our own 3D, never Google

Make the map **stunning** — "technology from the future" — using **only
geometry and shaders we generate ourselves**.

There is an existing Google Photorealistic 3D Tiles mode. **It stays, untouched,
behind its toggle.** But it must never be the reason the map looks good, and
nothing you build may depend on it. The default view — no API key, no billing,
no network beyond free open data — has to be the beautiful one.

What "stunning" means concretely, in rough priority order:

1. **Buildings that read as buildings.** They already carry a floor-plate stack
   and shader mullions. Push further: roof parapets, mechanical penthouses,
   water tanks, setbacks, crowns, spires. Manhattan's skyline is *silhouette*,
   and every tower currently ends in a flat lid.
2. **Streets and ground.** Real road geometry as 3D ribbons — kerbs, crossings,
   the block texture of the grid — rather than a flat basemap image underneath.
   Sidewalks. Street furniture at close zoom.
3. **Parks and water.** Central Park, Bryant Park, Madison Square, the rivers,
   piers. Greenery and water are what make a city model stop looking like a
   circuit board.
4. **Stations in 3D.** Subway entrances, station headhouses, ferry terminals as
   real modelled objects, not the marker posts they are now.
5. **Atmosphere.** Sky, horizon haze, time-of-day, depth cueing, a considered
   post-process pass. This is where "future technology" is won or lost.
6. **Motion.** Camera moves, transitions, and highlight behaviour that feel
   engineered rather than animated-by-default.

**Availability must get *more* legible as the world gets richer, not less.**
Every step should be checked against a busy frame with the availability bands
in it.

### B. Compare, on the map

Compare is currently a full-screen modal at `/map` driven by a bottom tray.
Move it onto the map as a **popup panel**, and make its lifecycle behave:

- Opens as a floating panel over the map, not a page takeover.
- Clicking anywhere else on the map closes it — the same behaviour every other
  popup now has.
- **Closing it does not empty it.** Reopening shows the same spaces still in it.
  This is the specific bug to avoid: dismissing the panel must not be confused
  with clearing the comparison.
- Everything is reachable from the map. A broker should never navigate away.

Current code: `src/components/compare/CompareView.tsx` and `CompareTray.tsx`;
state lives in `src/lib/store.ts` (`compare`, `compareOpen`, `addToCompare`,
`removeFromCompare`, `clearCompare`, `loadCompareFromUrl`). The compare set is
already shareable as a `?compare=` URL — keep that working.

---

## 3. The stack, and where things are

Next.js 15 App Router · React 19 · TypeScript strict · Tailwind ·
**deck.gl 9** over **MapLibre GL 4** · Neon Postgres + PostGIS · Vercel.

```
src/components/map/
  MapView.tsx        Map bootstrap, lighting, camera, popups, snapshot capture
  layers.ts          EVERY deck.gl layer is built here. Start reading here.
  mullions.ts        LayerExtension: shader curtain-wall on building walls
  colors.ts          All map colour, incl. per-theme palettes (dark + light)
  MapControls.tsx    The right-hand control stack
  useCityContext.ts  Surrounding city buildings (NYC footprints)
  useTransit.ts      Transit stops
  photoreal.ts       Google 3D Tiles mode — leave alone, keep working
src/lib/
  floor-bands.ts     Floor→band geometry, facade floor plates, contact shadows
  transit.ts         Transit data, walk times, grid walk routes, label layout
  city-context.ts    NYC building footprints + heights (free, keyless)
  admin-tables.ts    Admin data editor schema
  store.ts           Zustand app state
```

**Free data already wired and working** (no keys, all cached server-side):

| Source | What | Where |
|---|---|---|
| NYC Building Footprints `5zhs-2jue` | Real outlines + roof heights, whole city | `src/lib/city-context.ts` |
| MapPLUTO `64uk-42ks` | Floor counts, year built, owner | `src/lib/footprints.ts` |
| MTA Subway Stations `39hk-dx4f` | Stations + route letters | `src/lib/transit.ts` |
| MTA Bus Stops `2ucp-7wg5` | Stops + routes (filter `in_effect='true'`) | `src/lib/transit.ts` |
| CARTO basemap | Streets/labels, key-free | `MapView.tsx` |

Untapped and obvious for you: NYC **street centrelines** (LION / Centerline),
**sidewalks**, **parks properties**, **hydrography**, **street trees**, **subway
entrances**. All on `data.cityofnewyork.us`, all free. Proxy them through an API
route with `next: { revalidate }` and a snapped-bbox cache, exactly like
`src/app/api/context-buildings/route.ts` does — copy that pattern.

---

## 4. Traps that already cost this project real time

Every one of these was hit, diagnosed, and fixed. Do not rediscover them.

1. **Never modify fragment colour during a picking pass.** deck.gl encodes each
   object as an exact RGB value and reads it back from the framebuffer. Shading
   it *at all* makes it decode to the wrong object or none. Any shader injecting
   into `DECKGL_FILTER_COLOR` must guard with `!bool(picking.isActive)`. This
   broke building clicks twice.

2. **`_shadow: true` is off, and must stay off unless you fix both symptoms.**
   deck.gl's experimental shadow pass (a) corrupts picking exactly as above, and
   (b) at city scale over decorated facades produces textbook shadow acne — the
   zig-zag banding that reads as another building's shadow. It is currently
   replaced by **contact shadows** (concentric fading rings on the ground, see
   `contactShadowRings` in `floor-bands.ts`). If you want real shadows, you own
   both problems. Consider your own depth-based approach instead.

3. **Three surfaces, three radii.** Building wall at 1.0, floor plates at
   1.0015, availability collar at 1.02–1.035 — scaled about the footprint
   centroid. They z-fight the instant they share a radius.

4. **`SolidPolygonLayer` runs `DECKGL_FILTER_COLOR` in the VERTEX shader.** Its
   fragment shader has its own hook. Side faces define `IS_SIDE_VERTEX`; that
   guard is how wall-only effects avoid breaking roofs and other sublayers. See
   `mullions.ts` — it is a working, commented example of the whole technique.

5. **`ColumnLayer` takes one `radius` per layer, not an accessor.** Group data
   by size and emit a layer per group.

6. **MapLibre's stylesheet loads after Tailwind at equal specificity**, so
   `.maplibregl-map { position: relative }` beats `absolute inset-0` and the
   container collapses to zero height — a blank map with no error. The container
   uses inline styles. Do not "clean that up".

7. **MapLibre needs `preserveDrawingBuffer: true`** for the Stack Snapshot
   feature to capture the basemap. deck.gl's own canvas already preserves.

8. **Decoration must not cast shadows** (`shadowEnabled: false`, spread as an
   untyped object — it works but is missing from deck.gl's prop types).

9. **`getShaders(extension)`** is called with the *layer* as `this` and the
   extension as the argument. Reading options off `this` compiles and silently
   does nothing.

10. **Label collision is a real problem here.** See `layoutWalkLabels` in
    `transit.ts`: elliptical collision test (pills are far wider than tall),
    relaxation along each label's own line, and priority-based dropping when the
    geometry cannot fit them. Reuse this rather than reinventing it.

---

## 5. How to verify — this matters more than usual

**This project has been burned by a test that passed while the feature was
broken.** A click test asserted on text that also appeared in the sidebar, so it
passed whether or not the popup opened, and a real regression shipped twice.

Rules:

- **Assert on the thing itself.** `[role="dialog"]` for a popup, not text that
  exists elsewhere on the page.
- **Screenshot and actually look at it.** Playwright + headless Chromium is set
  up and is the only way to catch visual regressions. Chromium lives at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; launch with
  `--no-sandbox --use-gl=swiftshader --enable-unsafe-swiftshader`.
- **Sandbox caveat:** outbound HTTPS from headless Chromium may be blocked, so
  the CARTO basemap can render blank locally while working in production. Our
  own geometry renders fine. Do not chase that as a bug; do state it when you
  cannot verify something.
- **Test against the live database.** Put `DATABASE_URL` in `.env.local`,
  `npx next build && npx next start -p 3111`. Real data: 24 buildings,
  42 spaces, 23 landlords.
- Unit-test the geometry and layout maths (44 tests pass today, `npx vitest run`).
  Anything with a collision, a projection, or a coordinate transform in it
  deserves one.
- Gate every commit on `npx tsc --noEmit`, `npx next build`, `npx vitest run`.

**Performance is a feature.** This runs on a broker's laptop driving a
projector. Budget your geometry, LOD aggressively by zoom, and measure — a
beautiful map at 12fps loses the room.

---

## 6. Constraints, non-negotiable

- **No Google dependency** for the default experience. No new paid APIs without
  asking first.
- **Brand:** Cresa. Midnight `#001E5A`, Goldenrod `#FFB600`, plus Light/Dark
  Gray, Bright Blue `#0056DA`, Warm Orange `#FF8200`, Stadium Blue `#243E8C`.
  All in `src/lib/brand.ts`. Availability is always Goldenrod.
- **Both themes work.** Dark is default; light must not be an afterthought.
  Theme-dependent colour goes in `themeColors()` in `colors.ts`.
- **Never emojis.** Inline SVG only (`src/components/ui/Icon.tsx`).
- **No terminal commands in any user-facing setup documentation** (`SETUP.md`
  is click-by-click, on purpose, for non-technical staff).
- Keep `/admin`, Stack Snapshot, transit, compare-sharing, import and the
  photoreal toggle all working. This is a live tool.

---

## 7. Working agreement

- Branch: `claude/3dnyc-project-review-jsf7wf`. Merge to `main` only when asked;
  `main` auto-deploys to production.
- Commit in coherent slices with real commit messages explaining *why*, not
  *what*.
- **Say what you could not verify.** The user is technical enough to act on an
  honest limitation and is poorly served by a confident wrong claim.
- When something is genuinely not possible — as per-building selection out of
  Google's fused mesh was — say so plainly and offer the nearest real thing.

---

## 8. Suggested execution order

Each phase should end green, verified by screenshot, and committed.

| Phase | Work |
|---|---|
| 0 | Read `layers.ts`, `MapView.tsx`, `floor-bands.ts`, `mullions.ts`. Screenshot the map today — dark and light, wide and close, with and without transit. That is your baseline. |
| 1 | **Ground plane.** Street centrelines → 3D road ribbons with kerbs; sidewalks; block fills. Replaces reliance on the flat basemap image. |
| 2 | **Parks and water.** Park polygons with greenery treatment; hydrography with a water shader. Depth and colour, not flat fills. |
| 3 | **Building silhouette.** Parapets, mechanical penthouses, water tanks, setbacks, crowns. Derived procedurally from footprint + height + year built — a 1920s tower and a 2015 tower should not end the same way. |
| 4 | **Atmosphere.** Sky dome, distance haze, time-of-day, a post-process pass. Re-check availability legibility here. |
| 5 | **Stations in 3D.** Subway entrances and terminals as modelled objects. Add the subway-entrances dataset. |
| 6 | **Compare as a map popup**, with the persistence rule in §2B. |
| 7 | **Motion and polish.** Camera choreography, hover/selection states, transitions. |
| 8 | Performance pass, both themes, both zoom extremes. Full verification. Update `README.md`. |

Ship phases independently. A half-finished city that looks worse than today is
worse than today.
