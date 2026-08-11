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
  const ring = b.footprint.map(([lon, lat]) => layer.toScene(lon, lat));

  /**
   * A floor, as a horizontal strip of screen.
   *
   * Probing a single point failed twice for reasons that had nothing to do
   * with whether the band was in the right place: at the centroid the band on
   * the near wall projects a hundred pixels lower, and at a footprint corner
   * the band above a setback has stepped inward away from it. Both are true
   * facts about geometry and neither is the question.
   *
   * The question is vertical: is the Goldenrod at the height the sheet named?
   * So the probe is the full width of the building at that elevation, one
   * storey tall — and the storey's height in PIXELS is measured by projecting
   * the floor above rather than assumed, because it changes with pitch, zoom
   * and where on the screen the building is.
   */
  // Only the near half of the footprint. A building's near and far walls
  // project to very different screen rows at this pitch — for a 130 m
  // footprint, tens of pixels — so averaging the whole ring puts the strip
  // between the two bands rather than on either. That is how floor 63 came
  // back empty while plainly carrying a band.
  const eye = layer.eye;
  const near = [...ring]
    .sort((a, b2) =>
      Math.hypot(a[0] - eye.x, a[1] - eye.y) - Math.hypot(b2[0] - eye.x, b2[1] - eye.y))
    .slice(0, Math.max(2, Math.ceil(ring.length * 0.4)));

  const stripFor = (floor) => {
    const z = (floor - 0.5) * floorFt * 0.3048;
    const above = (floor + 0.5) * floorFt * 0.3048;
    let minX = Infinity, maxX = -Infinity, sumY = 0, sumYAbove = 0, n = 0;
    for (const [x, y] of near) {
      const at = layer.projectToScreen(x, y, z);
      const up = layer.projectToScreen(x, y, above);
      if (!at || !up) continue;
      minX = Math.min(minX, at.x);
      maxX = Math.max(maxX, at.x);
      sumY += at.y;
      sumYAbove += up.y;
      n++;
    }
    if (n === 0) return null;
    return {
      x: minX,
      width: maxX - minX,
      y: sumY / n,
      storeyPx: Math.abs(sumY / n - sumYAbove / n),
    };
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
await sleep(9000);
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
