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
