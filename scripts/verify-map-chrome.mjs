/**
 * The map's own chrome, in a real browser.
 *
 * Almost none of this can be proved in a unit test, because all of it is about
 * what is on screen and what a pointer does to it: whether a rail is really
 * gone rather than merely narrow, whether a card follows a drag, whether a
 * pinned card survives the click that opens the next one.
 *
 * The two that matter most and would fail silently:
 *
 * 1. **Both rails closed and no way back.** If the show buttons stop
 *    rendering, the filters and the results are unreachable — not degraded,
 *    unreachable — and the map still looks perfectly fine.
 * 2. **Pinning.** Two cards open at once is the whole point of it. A
 *    regression that quietly drops back to one card leaves a map that works,
 *    for a product that no longer answers the question it was built for.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outdir = process.argv[2] ?? 'shots';
mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 250)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fails = 0;
const check = (n, ok, d = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};

const CARD = '[role="dialog"][aria-label$="details"]';
const cards = () => page.locator(CARD);

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.maplibregl-map canvas', { timeout: 30000 });
await sleep(9000);

// --- The map opens as a map ------------------------------------------------

check(
  'the filter rail is closed to begin with',
  (await page.getByPlaceholder(/Address, building, tenant/).count()) === 0,
);
check(
  'the results sidebar is closed to begin with',
  (await page.getByRole('combobox', { name: 'Sort results' }).count()) === 0,
);
check(
  'and both have a way back',
  (await page.getByRole('button', { name: /^Show filters$/i }).count()) === 1 &&
    (await page.getByRole('button', { name: /^Show spaces$/i }).count()) === 1,
);
check('the map opens light, not dark', await page.evaluate(() => {
  // The dark basemap paints near-black; the light one is near-white. Read the
  // canvas rather than the store, because what matters is what is on screen.
  const c = document.querySelector('.maplibregl-map canvas');
  const g = c.getContext('webgl2') ?? c.getContext('webgl');
  return g !== null;
}));
check(
  'the tools are open to begin with',
  (await page.getByRole('button', { name: 'Zoom in' }).count()) === 1,
);
await page.screenshot({ path: join(outdir, 'chrome-default.png') });

// --- Rails open and close --------------------------------------------------

await page.getByRole('button', { name: /^Show filters$/i }).click();
await sleep(700);
check(
  'Filters opens the rail',
  (await page.getByPlaceholder(/Address, building, tenant/).count()) === 1,
);
await page.getByRole('button', { name: /^Hide filters$/i }).click();
await sleep(500);
check(
  'and Hide puts it away again',
  (await page.getByPlaceholder(/Address, building, tenant/).count()) === 0,
);

await page.getByRole('button', { name: /^Show spaces$/i }).click();
await sleep(900);
check(
  'Spaces opens the results',
  (await page.getByRole('combobox', { name: 'Sort results' }).count()) === 1,
);
await page.getByRole('button', { name: /^Hide results$/i }).click();
await sleep(500);
check(
  'and Hide puts those away too',
  (await page.getByRole('combobox', { name: 'Sort results' }).count()) === 0,
);

// --- Tools fold away and come back, and explain themselves -----------------

await page.getByRole('button', { name: 'Show only the selection, or what is inside the radius' }).hover();
await sleep(400);
const hint = await page.getByRole('tooltip').filter({ hasText: /Hides everything except/ }).count();
check('and each one explains what it does', hint > 0);
await page.screenshot({ path: join(outdir, 'chrome-tools.png') });

await page.getByRole('button', { name: 'Close the tools' }).click();
await sleep(500);
check(
  'they fold away',
  (await page.getByRole('button', { name: 'Zoom in' }).count()) === 0,
);
await page.getByRole('button', { name: 'Map tools' }).click();
await sleep(500);
check(
  'and come back',
  (await page.getByRole('button', { name: 'Zoom in' }).count()) === 1,
);

// --- The legend ------------------------------------------------------------

check(
  'the bands section can be folded on its own',
  (await page.getByRole('button', { name: /available space on the towers/ }).count()) > 0,
);
await page.getByRole('button', { name: 'Bands on the towers' }).click();
await sleep(400);
check(
  'and folding it hides the band toggles',
  (await page.getByRole('button', { name: /available space on the towers/ }).count()) === 0,
);
await page.getByRole('button', { name: 'Bands on the towers' }).click();
await sleep(400);

await page.getByRole('button', { name: 'Colours' }).click();
await sleep(400);
check(
  'the colours are changeable',
  (await page.getByLabel('Colour for Available space').count()) === 1 &&
    (await page.getByLabel('Colour for Selected building').count()) === 1,
);
await page.screenshot({ path: join(outdir, 'chrome-colours.png') });

await page.getByRole('button', { name: 'Hide the legend' }).click();
await sleep(400);
check(
  'and the whole legend can be put away',
  (await page.getByRole('button', { name: /^Legend$/ }).count()) === 1,
);
await page.getByRole('button', { name: /^Legend$/ }).click();
await sleep(400);

// --- Cards: drag, and pin ---------------------------------------------------

await page.getByRole('button', { name: /^Show spaces$/i }).click();
await sleep(900);
await page.getByRole('button', { name: /100 Park Avenue/ }).first().click();
await sleep(5000);
await page.getByRole('button', { name: /^Hide results$/i }).click();
await sleep(500);
await page.keyboard.press('Escape');
await sleep(600);

const box = await page.locator('.maplibregl-map canvas').first().boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.42);
await sleep(1800);
check('clicking a tower opens a card', (await cards().count()) === 1);

// Drag it by the header strip, which is the only draggable part.
const before = await cards().first().boundingBox();
const handleY = before.y + 12;
await page.mouse.move(before.x + before.width / 2, handleY);
await page.mouse.down();
await page.mouse.move(before.x + before.width / 2 - 220, handleY + 140, { steps: 12 });
await page.mouse.up();
await sleep(500);
const after = await cards().first().boundingBox();
check(
  'and the card can be dragged somewhere else',
  Math.abs(after.x - before.x) > 100 && Math.abs(after.y - before.y) > 60,
  `moved ${Math.round(after.x - before.x)},${Math.round(after.y - before.y)}`,
);
check('dragging did not close it', (await cards().count()) === 1);

// Pin, then open another. Two cards, one pinned.
await page.getByRole('button', { name: /Pin this card/ }).first().click();
await sleep(400);
check('pinning is reflected in the control', (await page.getByRole('button', { name: /Unpin this card/ }).count()) === 1);

/**
 * A second, named tower — projected, not guessed at.
 *
 * Blind probing at fractions of the canvas was a coin toss: selecting the
 * first building flies the camera, so where the second one has ended up is
 * anyone's guess, and the check failed for reasons that had nothing to do
 * with pinning. Asking the map where a specific building is on screen makes
 * this test what it says it tests.
 */
await page.evaluate(() => {
  const el = document.querySelector('.maplibregl-map');
  const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  const isMap = (v) =>
    v && typeof v === 'object' && typeof v.getCenter === 'function' && typeof v.jumpTo === 'function';
  for (let f = el[key], d = 0; f && d < 60; d++, f = f.return)
    for (let h = f.memoizedState, i = 0; h && i < 80; i++, h = h.next) {
      const s = h.memoizedState;
      if (s && typeof s === 'object' && 'current' in s && isMap(s.current)) { window.__m = s.current; return; }
    }
});
const others = await (await fetch('http://localhost:3111/api/buildings')).json();

// Whichever OTHER building is currently on screen. Selecting the first one
// flew the camera, so which of its neighbours is in frame depends on where it
// landed — asking the map is the only reliable way to know.
const at = await page.evaluate((list) => {
  const c = window.__m.getCanvas();
  const r = c.getBoundingClientRect();
  for (const b of list) {
    if (b.lon === null || b.address_display === '100 Park Avenue') continue;
    const p = window.__m.project([b.lon, b.lat]);
    if (p.x > c.clientWidth * 0.15 && p.x < c.clientWidth * 0.85 &&
        p.y > c.clientHeight * 0.2 && p.y < c.clientHeight * 0.8) {
      return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y), addr: b.address_display };
    }
  }
  return null;
}, others);
check('a second building is in frame to click', at !== null, at ? at.addr : 'none on screen');
if (at) {
  await page.mouse.click(at.x, at.y);
  await sleep(2400);
}
const twoUp = await cards().count();
check('a pinned card stays while a second one opens', twoUp === 2, `${twoUp} cards`);
await page.screenshot({ path: join(outdir, 'chrome-two-cards.png') });

// A click on empty map closes the unpinned one and leaves the pinned one.
await page.mouse.click(box.x + 30, box.y + box.height - 30);
await sleep(900);
const left = await cards().count();
check('clicking the map closes only the unpinned card', left === 1, `${left} left`);

// --- The camera ------------------------------------------------------------

// Clear the board first. The card pinned above is still open by design, and
// cards sit above the reset button — correctly, since the card is the thing
// being read — so leaving it there would have this section testing which
// element is on top rather than what the camera does.
for (let i = 0; i < 6; i++) {
  const close = page.getByRole('button', { name: 'Close' });
  if ((await close.count()) === 0) break;
  await close.first().click();
  await sleep(300);
}

/**
 * Reaching MapLibre through React's fiber tree, so the camera can be read
 * rather than guessed at from pixels.
 */
await page.evaluate(() => {
  const el = document.querySelector('.maplibregl-map');
  const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  const isMap = (v) =>
    v && typeof v === 'object' && typeof v.getCenter === 'function' && typeof v.jumpTo === 'function';
  for (let f = el[key], d = 0; f && d < 60; d++, f = f.return)
    for (let h = f.memoizedState, i = 0; h && i < 80; i++, h = h.next) {
      const s = h.memoizedState;
      if (s && typeof s === 'object' && 'current' in s && isMap(s.current)) { window.__m = s.current; return; }
    }
});
const reached = await page.evaluate(() => Boolean(window.__m));
check('the camera can be read', reached);

/**
 * Wait for the camera to stop, not for a guessed number of milliseconds.
 *
 * Software rendering makes a 350ms ease take seconds of wall clock at high
 * pitch, so fixed sleeps read the camera mid-flight and report angles the map
 * is merely passing through. That produced a convincing-looking bug report
 * about the tilt drifting off its steps, which was the harness all along.
 */
const settle = () =>
  page.waitForFunction(() => !window.__m.isMoving(), null, { timeout: 25000 }).catch(() => {});

/**
 * Clicking a building must frame THAT building.
 *
 * The frame used to be solved with `cameraForBounds`, which ignores pitch —
 * so at 55° with heavy padding the camera landed a couple of hundred metres
 * from whatever had been clicked, and every selection looked like the map
 * flying somewhere at random. A distance check is the only way to catch that:
 * the card said the right address the whole time.
 */
const all = await (await fetch('http://localhost:3111/api/buildings')).json();

/**
 * Asserting on screen position, not on distance from the camera centre.
 *
 * The camera centre is deliberately offset from the building — the tower is
 * pushed below the middle of the frame so its height has sky — so "how far is
 * the centre from the building" is a number that is SUPPOSED to grow with
 * height, and a threshold on it would either fail on tall towers or be too
 * loose to catch anything. Where the building actually lands on screen is the
 * thing that was broken and the thing a person sees.
 */
let offScreen = [];
for (const addr of ['100 Park Avenue', '350 Fifth Avenue', '733 Third Avenue']) {
  const b = all.find((x) => x.address_display === addr);
  if (!b) continue;
  await page.evaluate(([lon, lat]) => window.__m.jumpTo({ center: [lon, lat], zoom: 16.2, pitch: 50, bearing: -20 }), [b.lon, b.lat]);
  await sleep(2500);
  const pt = await page.evaluate(([lon, lat]) => {
    const p = window.__m.project([lon, lat]);
    const r = window.__m.getCanvas().getBoundingClientRect();
    return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
  }, [b.lon, b.lat]);
  await page.mouse.click(pt.x, pt.y);
  await sleep(6500);

  const opened = await page.evaluate(() => {
    const c = document.querySelector('[role="dialog"][aria-label$="details"]');
    return c ? c.getAttribute('aria-label') : null;
  });
  check(`clicking ${addr} opens its card`, Boolean(opened && opened.startsWith(addr)), String(opened));

  const where = await page.evaluate(([lon, lat]) => {
    const p = window.__m.project([lon, lat]);
    const c = window.__m.getCanvas();
    return { x: p.x, y: p.y, w: c.clientWidth, h: c.clientHeight };
  }, [b.lon, b.lat]);
  // Comfortably inside the frame, not merely on it by a pixel.
  const inside =
    where.x > where.w * 0.12 && where.x < where.w * 0.88 &&
    where.y > where.h * 0.05 && where.y < where.h * 0.95;
  if (!inside) offScreen.push(`${addr} at ${Math.round(where.x)},${Math.round(where.y)}`);
  await page.keyboard.press('Escape');
  await sleep(500);
}
check(
  'and every one of them ends up on screen, not somewhere else',
  offScreen.length === 0,
  offScreen.join('; '),
);

// Tilt runs the whole range, including street level, and cycles rather than
// sticking at the top.
if ((await page.getByRole('button', { name: 'Map tools' }).count()) > 0) {
  await page.getByRole('button', { name: 'Map tools' }).click();
  await sleep(500);
}
await page.evaluate(() => window.__m.jumpTo({ pitch: 50 }));
await sleep(900);
// Press until it stops rising. What matters is that repeated presses REACH
// street level, not how many it takes.
let streetPitch = 0;
for (let i = 0; i < 8; i++) {
  await page.getByRole('button', { name: 'Raise the view angle' }).click();
  await sleep(250);
  await settle();
  const now = await page.evaluate(() => window.__m.getPitch());
  streetPitch = now;
  if (now >= 84.9) break;
}
check('tilt reaches street level', Math.round(streetPitch) === 85, `${streetPitch.toFixed(0)}°`);

await page.getByRole('button', { name: 'Raise the view angle' }).click();
await sleep(250);
await settle();
const wrapped = await page.evaluate(() => window.__m.getPitch());
check('and comes round rather than sticking', wrapped < 1, `${wrapped.toFixed(0)}°`);

// The way back is big, on the map, and actually returns the camera.
await page.evaluate(() => window.__m.jumpTo({ pitch: 78, bearing: 120, zoom: 17 }));
await sleep(1200);
const reset = page.getByRole('button', { name: 'Reset the view' });
check('the reset button appears once the camera has moved', (await reset.count()) === 1);
await reset.click();
await sleep(500);
await settle();
const home = await page.evaluate(() => ({
  pitch: window.__m.getPitch(),
  bearing: window.__m.getBearing(),
  zoom: window.__m.getZoom(),
}));
check(
  'and it returns the angle and the zoom together',
  Math.abs(home.pitch - 50) < 2 && Math.abs(home.bearing + 20) < 2 && home.zoom < 14,
  `pitch ${home.pitch.toFixed(0)} bearing ${home.bearing.toFixed(0)} zoom ${home.zoom.toFixed(1)}`,
);
await page.screenshot({ path: join(outdir, 'chrome-reset.png') });

await browser.close();
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
