/**
 * The source markers, end to end, in a real browser.
 *
 * Three things here can only be proved at runtime:
 *
 * 1. The marker is reachable on the map itself, not just on the detail pages.
 * 2. Opening one does NOT close the card it sits on. The popover is portalled
 *    to the body, so as far as every dismiss-on-outside-click handler on this
 *    map is concerned it IS outside — which is exactly the bug this asserts
 *    against.
 * 3. Only one is open at a time, and Escape closes the popover without also
 *    closing the space popup underneath it.
 *
 * It asserts on the popover by its own attribute and on the space popup by
 * role and accessible name, never on text that also appears in the sidebar.
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
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const POPUP = '[role="dialog"][aria-label$="details"]';
const SOURCE = '[data-source-popover]';

const popovers = () => page.locator(SOURCE);
const popupOpen = () => page.locator(POPUP).count();

/**
 * Puts a lon/lat dead centre, straight down, and returns the pixel it lands on.
 *
 * A subway station is a few metres of geometry on a canvas. Clicking one by
 * eye does not work — I spent a long time proving that — so this asks the map
 * itself where the thing is, and at pitch 0 with the stop centred, its height
 * projects onto its own base, which makes the answer exact rather than
 * approximate.
 *
 * Reaching the map means walking React's fiber tree for the ref MapView keeps
 * it in. That is an internal, and if React changes shape this throws rather
 * than quietly skipping — a transit check that silently passes because it
 * never ran is the exact failure this file exists to avoid.
 */
async function aimAt(lon, lat, zoom = 18) {
  const reached = await page.evaluate(
    ([lon, lat, zoom]) => {
      const el = document.querySelector('.maplibregl-map');
      const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      if (!key) return false;
      const isMap = (v) =>
        v && typeof v === 'object' &&
        typeof v.project === 'function' && typeof v.jumpTo === 'function';
      for (let f = el[key], d = 0; f && d < 60; d++, f = f.return) {
        for (let h = f.memoizedState, i = 0; h && i < 80; i++, h = h.next) {
          const s = h.memoizedState;
          if (s && typeof s === 'object' && 'current' in s && isMap(s.current)) {
            s.current.jumpTo({ center: [lon, lat], zoom, pitch: 0, bearing: 0 });
            window.__verifyMap = s.current;
            return true;
          }
        }
      }
      return false;
    },
    [lon, lat, zoom],
  );
  if (!reached) throw new Error('could not reach the MapLibre instance — the fiber walk needs updating');
  await sleep(6000);
  return page.evaluate(
    ([lon, lat]) => {
      const p = window.__verifyMap.project([lon, lat]);
      const r = window.__verifyMap.getCanvas().getBoundingClientRect();
      return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
    },
    [lon, lat],
  );
}

// --- On the map ------------------------------------------------------------

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.maplibregl-map canvas', { timeout: 30000 });
await page.waitForSelector('text=100 Park Avenue', { timeout: 30000 });
await sleep(6000);

await page.getByRole('button', { name: /100 Park Avenue/ }).first().click();
await sleep(5000);
await page.keyboard.press('Escape');
await sleep(600);

// A genuine canvas pick, so this also re-proves the picking guard holds.
const box = await page.locator('.maplibregl-map canvas').first().boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.42);
await sleep(1600);
check('clicking a tower still opens the space popup', (await popupOpen()) > 0);

const markers = page.locator(`${POPUP} button[aria-label^="Where "]`);
const markerCount = await markers.count();
check('the space popup carries source markers', markerCount >= 4, `${markerCount} markers`);

await markers.first().click();
await sleep(500);
check('clicking a marker opens its source popover', (await popovers().count()) === 1);
check(
  'and does NOT close the space popup it sits on',
  (await popupOpen()) > 0,
  'the popover is portalled outside the card',
);
const first = (await popovers().first().textContent()) ?? '';
check('the popover names a source', first.trim().length > 20, first.slice(0, 70));
await page.screenshot({ path: join(outdir, 'sources-map-popup.png') });

// A second marker replaces the first rather than stacking beside it.
if (markerCount > 1) {
  await markers.nth(1).click();
  await sleep(500);
  check('only one popover is open at a time', (await popovers().count()) === 1);
  check('the space popup survives the second marker too', (await popupOpen()) > 0);
}

await page.keyboard.press('Escape');
await sleep(400);
check('Escape closes the popover', (await popovers().count()) === 0);
check('Escape does not also close the space popup', (await popupOpen()) > 0);

// Clicking the map behind it closes the popup, as it always did.
await page.mouse.click(box.x + 40, box.y + box.height - 40);
await sleep(800);

// --- On a station ----------------------------------------------------------

await page.getByRole('button', { name: 'Show transit stops and walk times' }).click();
await sleep(2000);

const { stops } = await (
  await fetch('http://localhost:3111/api/transit?bbox=-73.985,40.746,-73.968,40.758')
).json();

/** Opens a stop's popup and returns the text of one of its source popovers. */
async function stationSource(stop, marker) {
  const at = await aimAt(stop.lon, stop.lat);
  await page.mouse.click(at.x, at.y);
  await sleep(900);
  const button = page.getByRole('button', { name: marker });
  if ((await button.count()) === 0) return null;
  await button.first().click();
  await sleep(700);
  return ((await popovers().first().textContent()) ?? '').trim();
}

// The MTA publishes the subway. Aimed at the shelter under the name plate,
// which is where anyone would click — the sign pylon beside it is 1.1m square
// and sub-pixel below about zoom 17, so for a while nothing on a station was
// clickable at all.
const subway = stops.find((s) => s.mode === 'subway');
const subwayText = subway ? await stationSource(subway, 'Where this station came from') : null;
check('a station opens from the map and names its source', subwayText !== null);
check('the subway credits the MTA', /MTA open data/i.test(subwayText ?? ''), (subwayText ?? '').slice(0, 60));
await page.screenshot({ path: join(outdir, 'sources-transit.png') });
await page.keyboard.press('Escape');
await sleep(400);

// Its routes and the walk time are different questions with different answers.
const routes = await page.getByRole('button', { name: 'Where these routes came from' }).count();
check('the route bullets are marked too', routes > 0);
const walkBtn = page.getByRole('button', { name: 'Where this walk time came from' });
if ((await walkBtn.count()) > 0) {
  await walkBtn.first().click();
  await sleep(600);
  const walkText = ((await popovers().first().textContent()) ?? '').toLowerCase();
  check('the walk time admits it is an estimate', walkText.includes('estimate'), walkText.slice(0, 60));
  await page.keyboard.press('Escape');
  await sleep(400);
}

// Ferry landings and PATH have no maintained open dataset, so they are a
// hand-kept table in transit.ts and must not claim the MTA published them.
const handKept = stops.find((s) => s.mode === 'rail' || s.mode === 'path' || s.mode === 'ferry');
if (handKept) {
  const text = await stationSource(handKept, 'Where this station came from');
  check(
    `${handKept.mode} does not claim to be MTA data`,
    text !== null && !/MTA open data/i.test(text),
    (text ?? 'no popup').slice(0, 60),
  );
  check(
    `${handKept.mode} says it is hand-kept`,
    /hand/i.test(text ?? ''),
    (text ?? '').slice(0, 60),
  );
  await page.keyboard.press('Escape');
  await sleep(400);
}

// --- On the building page --------------------------------------------------

const buildings = await (await fetch('http://localhost:3111/api/buildings')).json();
const withSpaces = buildings.find((b) => (b.spaces ?? []).length > 1) ?? buildings[0];

await page.goto(`http://localhost:3111/building/${withSpaces.id}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForSelector('h1', { timeout: 20000 });
await sleep(2500);

const pageMarkers = page.locator('button[aria-label^="Where "]');
const pageCount = await pageMarkers.count();
check('the building page marks its values', pageCount >= 10, `${pageCount} markers`);

// The header chips mix three different sources; the class and the year built
// must not give the same answer.
await page.getByRole('button', { name: 'Where class came from' }).click();
await sleep(400);
const classText = ((await popovers().first().textContent()) ?? '').toLowerCase();
await page.screenshot({ path: join(outdir, 'sources-building-chip.png') });
await page.keyboard.press('Escape');
await sleep(300);

await page.getByRole('button', { name: 'Where year built came from' }).click();
await sleep(400);
const yearText = ((await popovers().first().textContent()) ?? '').toLowerCase();
check('class credits the sheet', classText.includes('sheet'), classText.slice(0, 60));
check('year built credits the city', yearText.includes('pluto'), yearText.slice(0, 60));
check('the two do not give the same answer', classText !== yearText);
await page.keyboard.press('Escape');
await sleep(300);

// Open a space so the detail panel — where annual rent lives — is on screen.
await page.locator('table tbody tr').first().click();
await sleep(1200);

// Annual rent is arithmetic, and has to say so.
const annual = page.getByRole('button', { name: 'Where annual rent came from' }).first();
check('the space detail is marked too', (await annual.count()) > 0);
if ((await annual.count()) > 0) {
  await annual.scrollIntoViewIfNeeded();
  await annual.click();
  await sleep(400);
  const text = ((await popovers().first().textContent()) ?? '').toLowerCase();
  check('annual rent is flagged as calculated', text.includes('estimate'), text.slice(0, 70));
  await page.screenshot({ path: join(outdir, 'sources-derived.png') });
  await page.keyboard.press('Escape');
  await sleep(300);
}

await page.screenshot({ path: join(outdir, 'sources-building.png'), fullPage: false });

// --- In compare ------------------------------------------------------------

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.maplibregl-map canvas', { timeout: 30000 });
await page.waitForSelector('text=100 Park Avenue', { timeout: 30000 });
await sleep(5000);

// Adding to compare opens the panel by itself, so there is no launcher to
// click — the first add is the gesture that opens it.
const addButtons = page.getByRole('button', { name: /^Add to compare$/ });
const toAdd = Math.min(3, await addButtons.count());
for (let i = 0; i < toAdd; i++) {
  await addButtons.nth(0).click();
  await sleep(600);
}
await sleep(2500);
check('compare opened with the added spaces', (await page.locator('table').count()) > 0);

const compareMarkers = page.locator('button[aria-label^="Where "]');
const compareCount = await compareMarkers.count();
check('compare marks its rows', compareCount >= 8, `${compareCount} markers`);

if (compareCount > 0) {
  await compareMarkers.first().click();
  await sleep(500);
  check('a marker opens inside compare', (await popovers().count()) === 1);
  check(
    'and compare stays open',
    (await page.getByText('Minimise').count()) > 0 ||
      (await page.locator('table').count()) > 0,
  );
  await page.screenshot({ path: join(outdir, 'sources-compare.png') });
  await page.keyboard.press('Escape');
  await sleep(400);
  check('compare survives dismissing the popover', (await page.locator('table').count()) > 0);
}

await browser.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
