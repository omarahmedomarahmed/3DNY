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
| Free camera | The eye, also Explore only — fly anywhere, look anywhere |
| Inside a space | A space card, in Explore mode: **Explore this space**. Or click a floor with an availability on it while in free look |
| Stand on a floor | A space card, in Explore mode: **Stand on floor 14** |
| Come back | Escape — from a floor to the street, from the street to the drone camera |

Walking: `W A S D` to move, `Q E` to turn, `R F` to look, `Shift` to move
faster.

Free camera: **drag** to look, **click** to select. The pointer is captured
only while the button is held, so the cursor is there the rest of the time and
changes shape over anything clickable. `W A S D` to fly, `Space` and `C` for
straight up and down, `Shift` for four times faster, `Escape` to leave.

Clicking a floor that carries an availability takes you **inside it**.

### Inside a space

**Explore this space** puts you on that availability's own floor, at its own
height, seated two-thirds of the way toward the glass and facing it. You can
walk to the window, look up at the tower opposite, and look down at the street
from exactly the height a tenant would.

| | |
|---|---|
| The floor | The building's own cross-section at that elevation — the same geometry the band is wrapped around, so the Goldenrod stripe is at the right height outside the glass |
| The glass | The host building's facade, redrawn from the inside as a mullion grid at six percent opacity. The grid runs on the same bay and storey pitch as the outside |
| Moving | Confined to the plate by `holdInside`, the walk's own containment. Walking at the glass stops you at the glass |
| Moving on | Click another tower to go into an availability in it. The building you are standing in is not clickable, which is what makes that work |
| Leaving | Escape puts you back outside, still in free look |

There is no partitioning, no core and no furniture, and that is deliberate:
this project holds no drawings for these spaces, and a floor plan invented for
one would be the map telling a broker something it does not know.

### Why free look exists, and what it costs

MapLibre's camera cannot look above the horizon. Its pitch is capped at 85
degrees and 90 degrees is level, so there is no setting of any MapLibre
parameter that puts the sky, the sun, or the top of a tower in the middle of
the frame. For a map that is the right constraint. For a model with a sky in
it, it means the one thing anybody does at the foot of a skyscraper — look up —
is unreachable.

So free look hands the projection to a camera of Explore's own, and MapLibre's
stays where it was.

| Still works | Does not, while it is on |
|---|---|
| The whole three.js city: ground, water, streets, massing, facades, roofs, **bands**, traffic, sky | deck.gl's name-plates, transit and radius — switched off, because they are projected with MapLibre's camera and would land in the wrong place |
| Every atmosphere preset and every filter | — |
| Clicking, hovering and going inside a space: free look raycasts the three.js massing itself | deck.gl's own picking, which cannot answer from a camera it is not projecting with |
| The streetscape and the surrounding city, which load around the free camera as it flies | — |

That trade is only acceptable because the availability bands are three.js
geometry. The one rule survives free look intact, which it would not have done
before the bands moved out of deck.gl.

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
| `lib/explore/freecam.ts` | The unconstrained camera: attitude, movement, clamps |
| `components/explore/*3d.ts` | Ground, sky, water, streets, roofs, bands, traffic |
| `components/explore/plate.ts` | The one walkable floor plate |
| `components/explore/useExplore.ts` | Wiring. `useWalk.ts` and `useFreeCam.ts` drive the camera |

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
npx vitest run                                    # 568 unit tests
npx tsc --noEmit && npx next build
SPACES_FIXTURE_DB=1 scripts/restart-server.sh     # or with a real DATABASE_URL
node scripts/verify-explore.mjs shots/explore
```

`verify-explore.mjs` asserts on pixels and on the scene's own state, never on
the presence of a control that might do nothing. In particular it projects a
known floor to a screen pixel and looks at those pixels: floors 14, 32 and 63
of the Empire State Building each carry Goldenrod inside their own storey-tall
strip, and floors 4, 5 and 6 carry none.

It also asserts, since the streets were once built, uploaded and drawn every
frame while being entirely invisible — every ground ribbon was wound clockwise,
so back-face culling removed the lot — that switching the streets **off**
changes the pixels. A triangle count proved nothing there and would not have
caught it.

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

`fixtures/dev-buildings.json` is gitignored and regenerated:

```
npx tsx scripts/make-dev-fixture.ts --live                  # the real market
npx tsx scripts/make-dev-fixture.ts --live --with-tenants   # plus synthetic tenancy
npx tsx scripts/make-dev-fixture.ts                         # fully synthetic
```

`--live` is a read-only snapshot of what `/api/buildings` serves: 73 buildings,
312 real availabilities, real landlords, provenance intact. The real database
holds **no tenancy**, so `--with-tenants` stamps synthetic tenancy on top — and
only tenancy; every availability, rent and provenance field is left exactly as
the live API returned it, and every invented row carries `FIXTURE` in its notes.

It is served only behind `SPACES_FIXTURE_DB=1` and is never a fallback for a
database that failed. See `src/lib/dev-fixture.ts`.

---

## Budget, measured

| | Target | Measured |
|---|---|---|
| Triangles in view | ≤ 2,000,000 | **351,389** with the whole city, streets, water and traffic |
| Draw calls | ≤ 1,000 | **64** |
| Load over today's bundle | ≤ 5 MB | ~170 KB gz of three.js, 150 KB gz of surveyed massing |
| Buildings with the full treatment | 73 today, 400 later | Merged per building; the context city is one mesh |

Frame rate is **not** measured here. The harness runs on SwiftShader in a
container, one to two orders of magnitude slower than a broker's laptop, and
any absolute figure from it would be meaningless. What is measured is that the
traffic costs no additional frame time on top of the city.
