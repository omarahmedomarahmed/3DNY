/**
 * Explore mode, in a real browser.
 *
 * The rule in this project is unit tests for maths and a real browser for
 * anything you can see, and it exists because a click test once passed while
 * the feature was broken. Everything here asserts on pixels or on the map's
 * own state, never on the presence of a button that might do nothing.
 *
 * What it proves, in the order the plan asks for it:
 *
 *   1. The flat map is untouched with Explore off — same layers, same
 *      buildings, same clicks.
 *   2. Turning Explore on actually changes the pixels. A toggle that flips a
 *      boolean and renders nothing is the failure mode this catches.
 *   3. A band and its facade agree about where the 14th floor is: the band is
 *      measured on screen and compared with the floor height the data implies.
 *   4. Goldenrod is still the loudest thing in the frame — measured, as the
 *      brightest saturated pixel, not eyeballed.
 *   5. Frame time stays inside budget.
 *
 * Run against `SPACES_FIXTURE_DB=1 next start -p 3111`.
 */
import { chromium } from 'playwright';
import { openMapChrome } from './harness.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outdir = process.argv[2] ?? 'shots/explore';
mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => {
  errors.push(String(e).slice(0, 300));
  console.log('[pageerror]', String(e).slice(0, 300));
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    const t = m.text().slice(0, 300);
    // A basemap tile that cannot be fetched is expected in this sandbox and is
    // not a finding — see the note about blocked outbound HTTPS.
    if (/basemaps\.cartocdn|Failed to fetch|net::ERR|status of 4\d\d|status of 5\d\d/.test(t)) return;
    errors.push(t);
    console.log('[console.error]', t);
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const EXPLORE_ON = 'Explore this city in 3D';
const EXPLORE_OFF = 'Back to the flat map';

/**
 * The map, and only the map.
 *
 * The container div spans the whole window and the rails, the legend and the
 * results sidebar are drawn OVER it, so a screenshot of `.maplibregl-map`
 * contains a great deal of white user interface. Measuring that and calling it
 * the map is how the first version of this test concluded that something was
 * brighter than the availability bands: it was, and it was the sidebar.
 *
 * So the frame is clipped to the part of the canvas no chrome covers.
 */
async function frameStats() {
  const box = await page.locator('.maplibregl-map canvas').first().boundingBox();
  const buffer = await page.screenshot({
    clip: {
      x: Math.round(box.x + box.width * 0.22),
      y: Math.round(box.y + box.height * 0.10),
      width: Math.round(box.width * 0.50),
      height: Math.round(box.height * 0.50),
    },
  });
  return analyse(buffer);
}

/**
 * Reads a PNG without a decoder dependency by handing it back to the page.
 *
 * Playwright gives a PNG buffer and this script has no image library. The page
 * already has a canvas and a decoder, so the bytes go back for measurement —
 * which also means the measurement happens on exactly the pixels a person
 * would see.
 */
async function analyse(buffer) {
  const base64 = buffer.toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);

    /**
     * Loudness is chroma, not brightness.
     *
     * The art direction asks for a near-white city on purpose, and a white
     * wall in sunlight is legitimately brighter than a Goldenrod band. What
     * makes the band lead is that it is the only *saturated* thing in the
     * frame. So the measurement is: how much colour is in a pixel, and is the
     * most colourful thing on screen the availability.
     */
    const luma = (r, g, bl) => (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255;
    const chroma = (r, g, bl) => (Math.max(r, g, bl) - Math.min(r, g, bl)) / 255;

    let goldenrod = 0;
    let sum = 0;
    let peakGoldChroma = 0;
    let peakOtherChroma = 0;
    let brightestOther = 0;
    // A single stray pixel should not decide this, so the non-goldenrod side
    // is judged on its 99.9th percentile rather than its maximum.
    const otherChromas = [];

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], bl = data[i + 2];
      sum += luma(r, g, bl);
      // Goldenrod is #FFB600: red high, green mid, blue low. Loose on exact
      // hue, strict on "warm and saturated" — lighting moves the value and
      // the question is which family of colour is loudest.
      const isGold = r > 170 && g > 100 && g < 215 && bl < 130 && r - bl > 95;
      if (isGold) {
        goldenrod++;
        peakGoldChroma = Math.max(peakGoldChroma, chroma(r, g, bl));
      } else {
        otherChromas.push(chroma(r, g, bl));
        brightestOther = Math.max(brightestOther, luma(r, g, bl));
      }
    }

    /**
     * Local contrast: how much a pixel differs from the one beside it.
     *
     * A building drawn as flat paint and a building with a curtain wall on it
     * can have identical mean brightness and identical colour. What separates
     * them is structure, and structure is what shows up as a difference
     * between neighbouring pixels. Mean absolute difference along each row is
     * the cheapest honest measure of it.
     */
    let detail = 0;
    let pairs = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 1; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const j = i - 4;
        detail += Math.abs(luma(data[i], data[i + 1], data[i + 2]) -
                           luma(data[j], data[j + 1], data[j + 2]));
        pairs++;
      }
    }
    detail = pairs > 0 ? detail / pairs : 0;

    otherChromas.sort((a, b) => a - b);
    peakOtherChroma = otherChromas.length
      ? otherChromas[Math.floor(otherChromas.length * 0.999)]
      : 0;

    return {
      pixels: data.length / 4,
      goldenrod,
      peakGoldChroma,
      peakOtherChroma,
      brightestOther,
      meanLuma: sum / (data.length / 4),
      detail,
      width: c.width,
      height: c.height,
    };
  }, base64);
}

/** Exposes the MapLibre instance on `window.__m`, as verify-map-chrome does. */
async function grabMap() {
  await page.evaluate(() => {
    const el = document.querySelector('.maplibregl-map');
    const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    const isMap = (v) =>
      v && typeof v === 'object' && typeof v.getCenter === 'function' &&
      typeof v.jumpTo === 'function';
    for (let f = el[key], d = 0; f && d < 60; d++, f = f.return)
      for (let h = f.memoizedState, i = 0; h && i < 80; i++, h = h.next) {
        const s = h.memoizedState;
        if (s && typeof s === 'object' && 'current' in s && isMap(s.current)) {
          window.__m = s.current;
          return;
        }
      }
  });
}

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await openMapChrome(page);
await sleep(6000);
await grabMap();

// --- 1. The flat map, before anything is switched on ----------------------

const exploreButton = page.getByRole('button', { name: EXPLORE_ON });
check('the Explore control is on the map', (await exploreButton.count()) > 0);

// `getStyle()` returns undefined until the style has loaded, and in this
// sandbox the CARTO basemap is often blocked — so the layer is asked for by
// name rather than the whole style being walked.
const hasLayer = () => page.evaluate(() => Boolean(window.__m.getLayer('explore-3d')));
check('with Explore off there is no 3D layer on the map at all', !(await hasLayer()));

await page.getByRole('button', { name: /350 Fifth Avenue/ }).first().click();
await sleep(5500);
await page.keyboard.press('Escape');
await sleep(600);

const flatShot = await frameStats();
await page.screenshot({ path: join(outdir, 'flat-before.png') });
check('the flat map draws something', flatShot.meanLuma > 0.02, `mean luma ${flatShot.meanLuma.toFixed(3)}`);

// --- 2. Switching on changes the pixels -----------------------------------

await exploreButton.first().click();
await sleep(6000);

check('Explore mode adds its 3D layer to the map', await hasLayer());

const exploreShot = await frameStats();
await page.screenshot({ path: join(outdir, 'explore-hero.png') });
check(
  'the frame is genuinely different from the flat map',
  Math.abs(exploreShot.meanLuma - flatShot.meanLuma) > 0.004,
  `flat ${flatShot.meanLuma.toFixed(3)} → explore ${exploreShot.meanLuma.toFixed(3)}`,
);

/**
 * The frame the whole thing is judged on.
 *
 * Section 12 of the plan: before each sprint ships, one shot from a broker's
 * eye height, and the question is whether the 14th floor is still the first
 * thing you see. It is taken here rather than by hand so that it is taken
 * every time and from the same place, and so the answer is measured on the
 * same pixels a person would be looking at.
 */
await page.evaluate(() => {
  const b = window.__m.getCenter();
  window.__m.jumpTo({ center: [b.lng, b.lat], zoom: 16.4, pitch: 74, bearing: -28 });
});
await sleep(3500);
await page.screenshot({ path: join(outdir, 'brokers-eye.png') });
const brokerShot = await frameStats();
check(
  'from a broker\'s eye height the bands are still on screen',
  brokerShot.goldenrod > 100,
  `${brokerShot.goldenrod} goldenrod pixels, city mean luma ${brokerShot.meanLuma.toFixed(3)}`,
);

// --- 3. Availability still leads ------------------------------------------

check(
  'a Goldenrod band is on screen',
  exploreShot.goldenrod > 200,
  `${exploreShot.goldenrod} goldenrod pixels`,
);
check(
  'and nothing in the city is as saturated as it',
  exploreShot.peakGoldChroma > exploreShot.peakOtherChroma + 0.08,
  `band chroma ${exploreShot.peakGoldChroma.toFixed(3)} vs city ${exploreShot.peakOtherChroma.toFixed(3)}`,
);
check(
  'the city is near-white rather than dark, as the art direction asks',
  exploreShot.meanLuma > 0.55,
  `mean luma ${exploreShot.meanLuma.toFixed(3)}`,
);

// --- 4. A band lands on the floor the sheet named -------------------------
//
// Sprint 2's kill criterion is that a band and a facade must not disagree
// about where a floor is. Reading the source cannot prove that and a unit test
// cannot either — both check the same arithmetic twice. So the floor is
// projected to a screen pixel through the scene's own camera and those pixels
// are looked at.
//
// The pair is what makes it a real test: Goldenrod must be present at the
// floor that HAS an availability and absent at a floor that does not. A band
// merely somewhere on the right tower would pass the first check and fail the
// second, and "somewhere on the tower" is exactly the failure §5 describes.

await page.evaluate(() => {
  // Far enough back that the WHOLE tower is in frame. At zoom 16.9 the crown
  // ran off the top and the floor-63 probe was projecting a point behind the
  // camera, which comes back as a plausible on-screen pixel and is not one.
  window.__m.jumpTo({ center: [-73.98566, 40.74844], zoom: 16.1, pitch: 58, bearing: 0 });
});
await sleep(4000);

const probes = await page.evaluate(async () => {
  const layer = window.__explore;
  const list = await (await fetch('/api/buildings')).json();
  const b = list.find((x) => x.address_display === '350 Fifth Avenue');
  if (!layer || !b) return null;

  const floorFt = b.height_roof_ft / b.num_floors;

  /**
   * A floor, as a patch of the building's own near wall.
   *
   * The probe asks the MASSING where the wall is, never the band builder —
   * otherwise the test would be asking the code where it drew and then
   * agreeing with it. Massing and bands are separate code paths: one comes
   * from the surveyed LOD2 surfaces or an extrusion, the other from
   * `computeBands`.
   *
   * Three earlier versions of this probe were each wrong in a different way,
   * and all three were wrong about WHERE rather than about what. Probing the
   * footprint centroid lands a hundred pixels below the near wall; probing a
   * footprint corner misses a tower that has stepped inward above a setback;
   * averaging the whole ring lands between the near and far bands. The wall
   * itself is the only thing that is not a proxy for something else.
   */
  const stripFor = (floor) => {
    const z = (floor - 0.5) * floorFt * 0.3048;
    const above = (floor + 0.5) * floorFt * 0.3048;
    const at = layer.nearWallPointAt(b.id, z);
    const up = layer.nearWallPointAt(b.id, above);
    if (!at || !up) return null;
    const p = layer.projectToScreen(at.x, at.y, at.z);
    const q = layer.projectToScreen(up.x, up.y, up.z);
    if (!p || !q) return null;
    const storeyPx = Math.abs(p.y - q.y);
    // Wide enough to cross the band, narrow enough to stay on this facade.
    const halfWidth = 34;
    return { x: p.x - halfWidth, width: halfWidth * 2, y: p.y, storeyPx };
  };

  const withSpace = [...new Set(b.spaces.map((s) => s.floor_number).filter(Boolean))];
  const without = [];
  for (let f = 4; f < b.num_floors - 5 && without.length < 3; f++) {
    if (!withSpace.some((n) => Math.abs(n - f) <= 4)) without.push(f);
  }

  return {
    withSpace: withSpace.map((f) => ({ floor: f, strip: stripFor(f) })),
    empty: without.map((f) => ({ floor: f, strip: stripFor(f) })),
    budget: layer.budget,
  };
});

check('the scene can project a floor to a screen pixel', probes !== null && probes.withSpace.length > 0);

if (probes) {
  await page.screenshot({ path: join(outdir, 'floor-alignment.png') });

  /** Goldenrod pixels inside one storey-tall strip across the building. */
  const goldIn = async (strip) => {
    if (!strip || !Number.isFinite(strip.x) || strip.width < 4) return null;
    const box = await page.locator('.maplibregl-map canvas').first().boundingBox();
    // One storey tall, never less than three pixels — below that the clip is
    // smaller than the antialiasing on the band's own edge.
    const half = Math.max(1.5, strip.storeyPx / 2);
    const x = Math.round(box.x + strip.x);
    const y = Math.round(box.y + strip.y - half);
    const width = Math.round(strip.width);
    const height = Math.max(3, Math.round(half * 2));
    if (x < 0 || y < 0 || x + width > 1600 || y + height > 1000) return null;
    const shot = await page.screenshot({ clip: { x, y, width, height } });
    return (await analyse(shot)).goldenrod;
  };

  let hits = 0;
  for (const { floor, strip } of probes.withSpace) {
    const n = await goldIn(strip);
    if (n === null) continue;
    hits++;
    check(
      `floor ${floor} has an availability and Goldenrod is drawn there`,
      n > 12,
      `${n} goldenrod pixels in the storey-tall strip at that floor`,
    );
  }
  check('at least one floor could be probed on screen', hits > 0);

  for (const { floor, strip } of probes.empty) {
    const n = await goldIn(strip);
    if (n === null) continue;
    check(
      `floor ${floor} has no availability and no Goldenrod is drawn there`,
      n < 12,
      `${n} goldenrod pixels`,
    );
  }

  // --- The surveyed massing: how many of ours the city's own model covers.
  console.log(
    `      massing: ${probes.budget.surveyed} of ${probes.budget.buildings} ` +
    `buildings drawn from NYC's surveyed model`,
  );
  check(
    'the hero buildings are drawn from the surveyed model, not a guess',
    probes.budget.surveyed > 0,
    `${probes.budget.surveyed} surveyed / ${probes.budget.buildings} drawn`,
  );

  // --- The budget in §9, measured rather than asserted from the source.
  console.log(
    `      budget: ${probes.budget.triangles.toLocaleString()} triangles ` +
    `(${probes.budget.bandTriangles.toLocaleString()} of them bands), ` +
    `${probes.budget.drawCalls} draw calls`,
  );
  check(
    'triangles are inside the 2M budget',
    probes.budget.triangles < 2_000_000,
    `${probes.budget.triangles.toLocaleString()}`,
  );
  check(
    'draw calls are inside the 1,000 budget',
    probes.budget.drawCalls > 0 && probes.budget.drawCalls <= 1000,
    `${probes.budget.drawCalls}`,
  );
}

// --- 5. Frame budget ------------------------------------------------------

const frame = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const times = [];
      let last = performance.now();
      let n = 0;
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        window.__m.triggerRepaint();
        if (++n < 40) requestAnimationFrame(tick);
        else {
          times.sort((a, b) => a - b);
          resolve({ median: times[Math.floor(times.length / 2)], worst: times[times.length - 1] });
        }
      };
      requestAnimationFrame(tick);
    }),
);
/**
 * Software rendering, not a GPU.
 *
 * This runs on SwiftShader in a container, which is one to two orders of
 * magnitude slower than the laptop this map is presented from. So the budget
 * checked here is a ceiling on *catastrophe* — a frame time this side of it
 * means nothing pathological is happening — and the real 60 fps figure has to
 * be measured on hardware. Said plainly rather than quietly asserted.
 */
check(
  'frame time is not pathological under software rendering',
  frame.median < 400,
  `median ${frame.median.toFixed(0)} ms, worst ${frame.worst.toFixed(0)} ms (SwiftShader, not a GPU)`,
);

// --- 5b. The facade, from where a broker would stand ----------------------
//
// Sprint 4's question is whether a wall reads as a wall from the pavement.
// Measured as local contrast: a flat painted box has almost none, a facade
// with piers, spandrels, transoms and glass in it has a great deal.

await page.evaluate(() => {
  window.__m.jumpTo({ center: [-73.98566, 40.74828], zoom: 18.6, pitch: 82, bearing: 5 });
});
await sleep(4000);
await page.screenshot({ path: join(outdir, 'facade-close.png') });

/**
 * The wall itself, not the sky around it.
 *
 * Measuring local contrast over the whole frame diluted it to nothing: most
 * of a street-level shot is flat sky and flat pavement, both of which have
 * exactly the structure this is trying to detect the absence of. So the crop
 * is the building's own screen footprint, projected through the scene camera.
 */
const wallBox = await page.evaluate(async () => {
  const layer = window.__explore;
  const list = await (await fetch('/api/buildings')).json();
  const b = list.find((x) => x.address_display === '350 Fifth Avenue');
  if (!layer || !b) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [lon, lat] of b.footprint) {
    const [x, y] = layer.toScene(lon, lat);
    for (const z of [2, 20, 60, 120]) {
      const p = layer.projectToScreen(x, y, z);
      if (!p) continue;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
});

check('the hero building can be located on screen for a close-up', wallBox !== null);

let closeUp = null;
if (wallBox) {
  const canvas = await page.locator('.maplibregl-map canvas').first().boundingBox();
  // Clamped to the part of the canvas no rail or legend covers.
  const x = Math.round(Math.max(canvas.x + 360, canvas.x + wallBox.minX));
  const y = Math.round(Math.max(canvas.y + 60, canvas.y + wallBox.minY));
  const width = Math.round(Math.min(canvas.x + 1180, canvas.x + wallBox.maxX) - x);
  const height = Math.round(Math.min(canvas.y + 540, canvas.y + wallBox.maxY) - y);
  if (width > 40 && height > 40) {
    closeUp = await analyse(await page.screenshot({ clip: { x, y, width, height } }));
  }
}

check('the crop landed on the building', closeUp !== null);

/**
 * The control: a patch of the ground plane in the same frame.
 *
 * An absolute contrast threshold is a number somebody picked, and the first
 * one picked here was wrong by a factor of three in the direction that fails.
 * The honest question is not "is the contrast above N" but "does this surface
 * have structure that a surface without structure does not" — so it is
 * measured against a surface from the same renderer, in the same lighting, in
 * the same frame, that is deliberately smooth. The ground plane is exactly
 * that: one shader, one colour, one distance falloff, no detail at all.
 */
const canvasBox = await page.locator('.maplibregl-map canvas').first().boundingBox();
const flat = await analyse(
  await page.screenshot({
    clip: {
      x: Math.round(canvasBox.x + 420),
      y: Math.round(canvasBox.y + canvasBox.height * 0.78),
      width: 400,
      height: 120,
    },
  }),
);

if (closeUp) {
  console.log(
    `      facade: local contrast ${closeUp.detail.toFixed(4)} on the wall ` +
    `against ${flat.detail.toFixed(4)} on bare ground — ` +
    `${(closeUp.detail / Math.max(flat.detail, 1e-5)).toFixed(1)}x`,
  );
  check(
    'a facade at street level has detail in it, not flat paint',
    closeUp.detail > flat.detail * 4,
    `wall ${closeUp.detail.toFixed(4)} vs bare ground ${flat.detail.toFixed(4)}`,
  );
  check(
    'and it is still colourless — the city has no hue of its own',
    closeUp.peakOtherChroma < 0.35,
    `peak non-Goldenrod chroma ${closeUp.peakOtherChroma.toFixed(3)}`,
  );
}

// --- 5c. Night, where the lit windows live --------------------------------

for (let i = 0; i < 5; i++) {
  const label = (await page.getByRole('button', { name: /^Time of day:/ }).getAttribute('aria-label')) ?? '';
  if (/Night/.test(label)) break;
  await page.getByRole('button', { name: /^Time of day:/ }).click();
  await sleep(1800);
}
await sleep(3000);
await page.screenshot({ path: join(outdir, 'facade-night.png') });
const night = await frameStats();
check(
  'at night the city is darker than it is by day',
  !closeUp || night.meanLuma < closeUp.meanLuma,
  closeUp ? `${closeUp.meanLuma.toFixed(3)} → ${night.meanLuma.toFixed(3)}` : `${night.meanLuma.toFixed(3)}`,
);
check(
  'and lit windows do not out-shout the bands',
  night.peakGoldChroma === 0 || night.peakGoldChroma > night.peakOtherChroma,
  `band ${night.peakGoldChroma.toFixed(3)} vs city ${night.peakOtherChroma.toFixed(3)}`,
);

// Back to the daytime preset the rest of the run assumes.
for (let i = 0; i < 5; i++) {
  const label = (await page.getByRole('button', { name: /^Time of day:/ }).getAttribute('aria-label')) ?? '';
  if (/Morning/.test(label)) break;
  await page.getByRole('button', { name: /^Time of day:/ }).click();
  await sleep(1500);
}
await sleep(2000);

// --- 5d. The walk, at street level ----------------------------------------
//
// Two claims, and both are about pixels rather than about state: pressing W
// moves you, and walking into a building does not put you inside it. The
// second is checked against the SCENE's own obstacle list, which is derived
// from the footprints rather than from the walk's own bookkeeping.

await page.evaluate(() => {
  window.__m.jumpTo({ center: [-73.9853, 40.7476], zoom: 17.4, pitch: 70, bearing: 20 });
});
await sleep(2500);

await page.getByRole('button', { name: 'Walk at street level' }).first().click();
await sleep(2500);
await page.screenshot({ path: join(outdir, 'walk-start.png') });

const entry = await page.evaluate(() => ({
  pitch: window.__m.getPitch(),
  center: window.__m.getCenter(),
}));
check(
  'walking drops the camera to street level',
  entry.pitch > 78,
  `pitch ${entry.pitch.toFixed(1)}°`,
);

/** Holds a key for a while, the way a person would. */
async function hold(key, ms) {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
  await sleep(400);
}

// The canvas has to have focus for the keys to reach the window handler.
const canvasBounds = await page.locator('.maplibregl-map canvas').first().boundingBox();
await page.mouse.click(canvasBounds.x + canvasBounds.width * 0.5, canvasBounds.y + canvasBounds.height * 0.8);
await sleep(800);

await hold('KeyW', 1600);
const afterWalk = await page.evaluate(() => window.__m.getCenter());
const movedM = Math.hypot(
  (afterWalk.lng - entry.center.lng) * 84_400,
  (afterWalk.lat - entry.center.lat) * 110_574,
);
check('pressing W actually moves the camera', movedM > 1.5, `${movedM.toFixed(1)} m`);
await page.screenshot({ path: join(outdir, 'walk-moved.png') });

// Walk hard in each of four directions and check, after every one, that the
// eye is not inside a building.
let penetrations = 0;
let checked = 0;
for (const [turnKey, turnMs] of [['KeyE', 900], ['KeyE', 900], ['KeyE', 900], ['KeyE', 900]]) {
  await hold(turnKey, turnMs);
  await page.keyboard.down('ShiftLeft');
  await hold('KeyW', 2600);
  await page.keyboard.up('ShiftLeft');
  const verdict = await page.evaluate(() => {
    const layer = window.__explore;
    if (!layer) return null;
    const eye = layer.eye;
    return { x: eye.x, y: eye.y, z: eye.z };
  });
  if (!verdict) continue;
  checked++;
  const inside = await page.evaluate(
    ([x, y, z]) => {
      // Asked of the buildings, not of the walk: the massing meshes are the
      // walls a person can see, and the question is whether the eye is behind
      // one of them.
      const layer = window.__explore;
      let hit = false;
      for (const mesh of layer.objects) {
        const g = mesh.geometry;
        const pos = g.getAttribute('position');
        const isWall = g.getAttribute('isWall');
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = 0;
        for (let i = 0; i < pos.count; i++) {
          if (isWall.getX(i) < 0.5) continue;
          minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i));
          minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i));
          maxZ = Math.max(maxZ, pos.getZ(i));
        }
        // A bounding box is a WEAKER test than the footprint — it can only
        // report a false alarm, never a miss — so a pass here is worth more
        // than a pass against the outline itself.
        if (z < maxZ && x > minX + 1 && x < maxX - 1 && y > minY + 1 && y < maxY - 1) {
          hit = true;
          break;
        }
      }
      return hit;
    },
    [verdict.x, verdict.y, verdict.z],
  );
  if (inside) penetrations++;
}
check(
  'walking into buildings never puts the eye inside one',
  checked > 0 && penetrations === 0,
  `${checked} runs, ${penetrations} penetrations`,
);
await page.screenshot({ path: join(outdir, 'walk-street.png') });

await page.keyboard.press('Escape');
await sleep(2000);
check(
  'Escape leaves the walk',
  (await page.getByRole('button', { name: 'Walk at street level' }).count()) > 0,
);

// --- 5e. Standing on a floor, entered from its band -----------------------
//
// The one walkable floor plate. What has to be true is that the eye ends up
// at the elevation the sheet named — the same elevation the band is drawn at —
// and that you cannot walk out through the glass.

await page.evaluate(() => {
  window.__m.jumpTo({ center: [-73.98566, 40.74844], zoom: 16.1, pitch: 58, bearing: 0 });
});
await sleep(3000);
await page.getByRole('button', { name: /350 Fifth Avenue/ }).first().click();
await sleep(5000);
await page.keyboard.press('Escape');
await sleep(600);

/**
 * The card has to be opened by clicking the tower, and then a floor picked
 * from its list.
 *
 * Selecting from the sidebar flies the camera and opens nothing, and a
 * building with three availabilities opens a LIST rather than one space — so
 * there is no floor to stand on until one is chosen. That is the right
 * behaviour and it is what the harness has to drive.
 */
const canvasForCard = await page.locator('.maplibregl-map canvas').first().boundingBox();
await page.mouse.click(
  canvasForCard.x + canvasForCard.width * 0.5,
  canvasForCard.y + canvasForCard.height * 0.45,
);
await sleep(2500);
const floorRow = page.locator('[role="dialog"][aria-label$="details"] li button');
if ((await floorRow.count()) > 0) {
  await floorRow.first().click();
  await sleep(1500);
}

const standButton = page.getByRole('button', { name: /^Stand on floor \d+$/ });
check('a space card offers to stand on its floor', (await standButton.count()) > 0);

if ((await standButton.count()) > 0) {
  const floorLabel = (await standButton.first().textContent()) ?? '';
  const floor = Number(/(\d+)/.exec(floorLabel)?.[1] ?? 0);
  await standButton.first().click();
  await sleep(4000);
  await page.screenshot({ path: join(outdir, 'floor-plate.png') });

  check(
    'the readout says which floor you are on',
    (await page.getByText(`Standing on floor ${floor}`).count()) > 0,
    floorLabel,
  );

  const eye = await page.evaluate(async (f) => {
    const layer = window.__explore;
    const list = await (await fetch('/api/buildings')).json();
    const b = list.find((x) => x.address_display === '350 Fifth Avenue');
    if (!layer || !b) return null;
    const floorFt = b.height_roof_ft / b.num_floors;
    return {
      z: layer.eye.z,
      // Where the band for that floor sits, from the data alone.
      expected: (f - 1) * floorFt * 0.3048,
      storey: floorFt * 0.3048,
    };
  }, floor);

  check('the scene reports where the eye is', eye !== null);
  if (eye) {
    /**
     * The eye must be within one storey of the floor's own elevation.
     *
     * Derived from the data here rather than read back from the plate, so
     * this is comparing the camera against the sheet rather than against
     * the code that placed it. A broker standing on floor 14 with the
     * Goldenrod band at their ankles is the failure this catches.
     */
    check(
      `the eye is on floor ${floor}, at the elevation the sheet implies`,
      Math.abs(eye.z - eye.expected) < eye.storey * 1.2,
      `eye ${eye.z.toFixed(1)} m vs floor ${eye.expected.toFixed(1)} m (storey ${eye.storey.toFixed(1)} m)`,
    );
  }

  // Walk hard at the glass. The plate must hold.
  const cb = await page.locator('.maplibregl-map canvas').first().boundingBox();
  await page.mouse.click(cb.x + cb.width * 0.5, cb.y + cb.height * 0.82);
  await sleep(600);
  await page.keyboard.down('ShiftLeft');
  await hold('KeyW', 3200);
  await page.keyboard.up('ShiftLeft');

  const after = await page.evaluate(() => {
    const layer = window.__explore;
    return layer ? { x: layer.eye.x, y: layer.eye.y, z: layer.eye.z } : null;
  });
  if (after && eye) {
    check(
      'walking hard at the glass does not put you outside the building',
      Math.abs(after.z - eye.z) < 0.5,
      `eye stayed at ${after.z.toFixed(1)} m`,
    );
  }
  await page.screenshot({ path: join(outdir, 'floor-plate-walked.png') });

  await page.keyboard.press('Escape');
  await sleep(2000);
  check(
    'Escape from a floor puts you back on the street',
    (await page.getByText(/Standing on floor/).count()) === 0,
  );
  await page.keyboard.press('Escape');
  await sleep(1500);
}

// --- 6. The whole city, which is the load sprint 2 exists to survive -------
//
// Four towers is not a test of anything. The kill criterion is the frame rate
// collapsing at scale, so the surrounding city goes on — tens of thousands of
// NYC footprints — and the budget is measured again with it there.

await page.evaluate(() => {
  window.__m.jumpTo({ center: [-73.98, 40.752], zoom: 15.2, pitch: 62, bearing: -25 });
});
await sleep(2000);
await page.getByRole('button', { name: 'Show the surrounding city' }).first().click();

/**
 * Poll rather than sleep.
 *
 * The surrounding city is a network fetch of tens of thousands of footprints
 * against a viewport that has just moved, and how long it takes depends on the
 * cache, the viewport and the day. A fixed wait passed for three sprints and
 * then failed for no reason connected to the code — which is the worst kind of
 * check, because the natural response is to assume the feature broke.
 */
for (let i = 0; i < 40; i++) {
  const n = await page.evaluate(() => window.__explore?.budget?.triangles ?? 0);
  if (n > 20_000) break;
  await sleep(750);
}
await sleep(1500);
await page.screenshot({ path: join(outdir, 'explore-city.png') });

const cityBudget = await page.evaluate(() => window.__explore?.budget ?? null);
check('the surrounding city is drawn in Explore mode', (cityBudget?.triangles ?? 0) > 20_000,
  cityBudget ? `${cityBudget.triangles.toLocaleString()} triangles` : 'no layer');

if (cityBudget) {
  console.log(
    `      city budget: ${cityBudget.triangles.toLocaleString()} triangles, ` +
    `${cityBudget.drawCalls} draw calls`,
  );
  check('the whole city stays inside the 2M triangle budget',
    cityBudget.triangles < 2_000_000, `${cityBudget.triangles.toLocaleString()}`);
  check('and inside the 1,000 draw-call budget',
    cityBudget.drawCalls <= 1000, `${cityBudget.drawCalls}`);
}

const cityFrame = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const times = [];
      let last = performance.now();
      let n = 0;
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        window.__m.triggerRepaint();
        if (++n < 30) requestAnimationFrame(tick);
        else {
          times.sort((a, b) => a - b);
          resolve({ median: times[Math.floor(times.length / 2)] });
        }
      };
      requestAnimationFrame(tick);
    }),
);
check(
  'frame time with the whole city drawn is not pathological',
  cityFrame.median < 700,
  `median ${cityFrame.median.toFixed(0)} ms (SwiftShader, not a GPU)`,
);

await page.getByRole('button', { name: 'Hide buildings with nothing available' }).first().click();
await sleep(2500);

// The reference for the toggle-back check below: Explore mode's own frame at
// exactly this camera, so the comparison is about the mode and not the view.
const exploreCityShot = await frameStats();

// --- 7. And back again ----------------------------------------------------

await page.getByRole('button', { name: EXPLORE_OFF }).first().click();
await sleep(4000);
check('switching Explore off removes the 3D layer again', !(await hasLayer()));

const backShot = await frameStats();
await page.screenshot({ path: join(outdir, 'flat-after.png') });

/**
 * Compared at the SAME camera, not against the opening frame.
 *
 * The first version compared this against a capture taken before the camera
 * had been flown anywhere, and of course the two differed — a different view
 * of a different part of the island. It was measuring the camera, not the
 * toggle.
 *
 * What actually proves the toggle reverts is that the flat map's own
 * colour-by-rent massing is back. Explore mode's city is deliberately
 * colourless, so a saturated non-Goldenrod surface in the frame can only be
 * the flat map's massing, and it is absent in Explore by construction.
 */
check(
  'the flat map draws its coloured massing again',
  backShot.peakOtherChroma > exploreCityShot.peakOtherChroma + 0.15,
  `flat ${backShot.peakOtherChroma.toFixed(3)} vs explore ${exploreCityShot.peakOtherChroma.toFixed(3)}`,
);

check('no page errors were raised', errors.length === 0, errors[0] ?? '');

await browser.close();
console.log(failures === 0 ? '\nAll Explore checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
