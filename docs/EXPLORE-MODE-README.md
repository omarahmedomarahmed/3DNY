# Explore mode — how it works

A second mode on `/map`, reached by a button. Manhattan as a real-time 3-D
model you move through, with the availability data still driving it.

The flat map is untouched. With Explore off there is no 3-D layer on the map at
all — not hidden, not idle, absent — and the seven existing browser suites sit
exactly where they did before this branch started.

---

## Turning it on

| | |
|---|---|
| Explore | The cube button in the right-hand tool stack |
| Walk | The walking figure, which only appears in Explore mode |
| Stand on a floor | A space card, in Explore mode: **Stand on floor 14** |
| Come back | Escape — from a floor to the street, from the street to the drone camera |

Walking: `W A S D` to move, `Q E` to turn, `R F` to look, `Shift` to move
faster.

---

## How it is put together

```
MapLibre GL           basemap, camera, projection            unchanged
  └─ custom layer  →  three.js       ground, streets, massing, facades,
  │                                   roofs, bands, traffic, floor plate
  └─ MapboxOverlay →  deck.gl        name-plates, transit, radius,
                                      and invisible pickable copies of the
                                      buildings and the bands
```

three.js renders into MapLibre's own WebGL context, with MapLibre's own
projection matrix. One depth buffer, one camera, so a facade and a floor band
cannot disagree about where the 14th floor is.

deck.gl's overlay is a **separate canvas composited above** MapLibre's. That
single fact decides most of the architecture: anything opaque deck.gl draws
paints over the three.js city entirely, so in Explore mode deck.gl draws only
what belongs on top of the world — plus fully transparent copies of the
buildings and the bands, which is what keeps every click, popup, fly-to and
Compare behaviour working with no changes in either mode.

### Where things live

| File | |
|---|---|
| `lib/explore/frame.ts` | The scene's metric frame: metres, +X east, +Y north, +Z up. Ring maths, point-in-ring, nearest edge |
| `lib/explore/tessellate.ts` | Ear clipping, in 2-D and for planar polygons in 3-D |
| `lib/explore/massing.ts` | Footprint + height → vertex arrays. The stepped fallback profile |
| `lib/explore/lod2.ts` | NYC's surveyed CityGML → geometry, height profile, cross-sections |
| `lib/explore/lod2-registry.ts` | The surveyed asset, once, for everything that needs it |
| `lib/explore/profile.ts` | How wide a building is at a height — the whole of §5 |
| `lib/explore/sun.ts` | Solar position, so three.js and deck.gl agree about the sun |
| `lib/explore/camera.ts` | MapLibre's camera model, forwards and inverted |
| `lib/explore/walk.ts` | Capsule collision, the walk step, floor plates |
| `lib/explore/agents.ts` | Cars and people on the street graph |
| `lib/explore/eligibility.ts` | Which buildings get the full treatment |
| `components/explore/ExploreLayer.ts` | The MapLibre custom layer and the three.js scene |
| `components/explore/materials.ts` | The facade shader: bays, glass, interior mapping |
| `components/explore/*3d.ts` | Ground, streets, roofs, bands, traffic |
| `components/explore/plate.ts` | The one walkable floor plate |
| `components/explore/useExplore.ts` | Wiring. `useWalk.ts` drives the camera |

Everything in `lib/explore/` is pure — no three.js, no WebGL, no DOM — and is
unit tested. That is deliberate: the maths is what decides whether a Goldenrod
band lands on the 14th floor or somewhere near it.

---

## The surveyed massing

`public/lod2/massing.json` is **gitignored and regenerated in about twenty
seconds**:

```
npx tsx scripts/fetch-lod2-massing.ts
npx tsx scripts/fetch-lod2-massing.ts --from=fixtures/dev-buildings.json
```

The first form reads BINs from the database. The second reads them from a JSON
file, for a machine with no connection string.

Without it, every building falls back to its extruded footprint — which is a
perfectly good map and exactly what the two buildings the 2014 survey predates
get permanently. Explore mode never refuses to open because the asset is
missing.

---

## Verifying it

```
npx vitest run                                    # 526 unit tests
npx tsc --noEmit && npx next build
SPACES_FIXTURE_DB=1 scripts/restart-server.sh     # or with a real DATABASE_URL
node scripts/verify-explore.mjs shots/explore
```

`verify-explore.mjs` asserts on pixels and on the scene's own state, never on
the presence of a control that might do nothing. In particular it projects a
known floor to a screen pixel and looks at those pixels: floors 14, 32 and 63
of the Empire State Building each carry Goldenrod inside their own storey-tall
strip, and floors 4, 5 and 6 carry none.

Two measurement rules it follows, both learned the hard way:

- **Loudness is chroma, not brightness.** A near-white city in sunlight is
  legitimately brighter than `#FFB600`. What makes a band lead is being the
  only saturated thing in the frame.
- **Compare against a control in the same frame, not against a number.** Facade
  detail is measured against a patch of bare ground plane; frame cost is
  measured against the same scene with the traffic switched off.

---

## The development fixture

This branch can be run with no database:

```
SPACES_FIXTURE_DB=1 npx next start -p 3111
```

`fixtures/dev-buildings.json` — real BINs, footprints, heights, floor counts
and years from NYC Open Data; **invented** availability and tenancy rows, each
one stamped `FIXTURE` in its own notes. It is served only behind that flag and
is never a fallback for a database that failed. See `src/lib/dev-fixture.ts`.

---

## Budget, measured

| | Target | Measured |
|---|---|---|
| Triangles in view | ≤ 2,000,000 | **189,107** with the whole city, streets and traffic |
| Draw calls | ≤ 1,000 | **22** |
| Load over today's bundle | ≤ 5 MB | ~170 KB gz of three.js, 150 KB gz of surveyed massing |
| Buildings with the full treatment | 73 today, 400 later | Merged per building; the context city is one mesh |

Frame rate is **not** measured here. The harness runs on SwiftShader in a
container, one to two orders of magnitude slower than a broker's laptop, and
any absolute figure from it would be meaningless. What is measured is that the
traffic costs no additional frame time on top of the city.
