/**
 * Building clicks still work.
 *
 * This exists because of trap #1: any shader that injects into
 * DECKGL_FILTER_COLOR runs during the picking pass too, and deck.gl decodes
 * object ids from exact RGB values read back out of the framebuffer. Tint them
 * and clicks resolve to the wrong object or to none. That has broken this map
 * twice — silently, because the scene still looks perfect.
 *
 * Every shader added here (mullions, and now distance haze) guards with
 * `!bool(picking.isActive)`. This proves the guards actually hold at runtime,
 * which reading the source cannot.
 *
 * It asserts on the popup ITSELF — role="dialog" — and on the popup's own
 * heading matching the tower that was clicked, never on text that also lives
 * in the sidebar.
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

/** The space popup, by role and its own accessible name pattern. */
const POPUP = '[role="dialog"][aria-label$="details"]';

async function popupTitle() {
  try {
    return (await page.locator(`${POPUP} h2`).first().textContent({ timeout: 4000 }))?.trim() ?? '';
  } catch {
    return '';
  }
}

/**
 * Clicks the pixel at the centre of the selected building's own tower.
 * Selecting first flies the camera onto it, so the middle of the map canvas
 * is reliably that building's massing.
 */
async function clickTower() {
  const box = await page.locator('.maplibregl-map canvas').first().boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.42);
  await sleep(1400);
}

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.maplibregl-map canvas', { timeout: 30000 });
await page.waitForSelector('text=100 Park Avenue', { timeout: 30000 });
await sleep(6000);

// Fly onto a known tower so the centre of the frame is its massing.
await page.getByRole('button', { name: /100 Park Avenue/ }).first().click();
await sleep(5000);

// Dismiss whatever the sidebar selection opened, so the next popup is proof
// of a genuine canvas pick rather than a leftover.
await page.keyboard.press('Escape');
await sleep(600);

await clickTower();
let title = await popupTitle();
check('clicking a tower opens the space popup', title.length > 0, title || 'no dialog');
check('the popup names the building that was clicked', /100 Park/i.test(title), title);
await page.screenshot({ path: join(outdir, 'picking-default.png') });

// --- The same click at every hour. Haze strength varies per preset, and a
// guard that held at one strength but not another would be the worst kind of
// intermittent failure.
for (let i = 0; i < 4; i++) {
  await page.keyboard.press('Escape');
  await sleep(400);
  const btn = page.getByRole('button', { name: /^Time of day:/ });
  const label = (await btn.getAttribute('aria-label')) ?? '';
  const hour = /Time of day: ([^.]+)\./.exec(label)?.[1] ?? `hour ${i}`;
  await btn.click();
  await sleep(2600);

  await clickTower();
  const t = await popupTitle();
  check(`picking survives the haze shader at ${hour}`, /100 Park/i.test(t), t || 'no dialog');
}

// --- And with the grey city and its roof furniture drawn, which is the
// heaviest scene and the one where a mis-decoded id is most likely.
await page.keyboard.press('Escape');
await sleep(400);
await page.getByRole('button', { name: 'Show the surrounding city' }).click();
await sleep(5000);
await clickTower();
const busy = await popupTitle();
check('picking survives a busy frame with the whole city drawn', /100 Park/i.test(busy), busy);
await page.screenshot({ path: join(outdir, 'picking-busy.png') });

// --- A click on empty sky must pick nothing, not something arbitrary. A
// shader that corrupts ids tends to produce phantom hits as readily as misses.
await page.keyboard.press('Escape');
await sleep(500);
const box = await page.locator('.maplibregl-map canvas').first().boundingBox();
await page.mouse.click(box.x + box.width * 0.06, box.y + box.height * 0.06);
await sleep(1200);
check('clicking empty space picks nothing', (await popupTitle()) === '');

await browser.close();
console.log(failures === 0 ? '\nAll picking checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
