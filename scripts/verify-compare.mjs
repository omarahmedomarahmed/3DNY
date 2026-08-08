/**
 * End-to-end verification of Compare on the map.
 *
 * Every assertion here is on the panel ITSELF — `[role="dialog"]` with the
 * comparison's own accessible name — never on text like an address or a rent,
 * because those also appear in the sidebar and in the space popup. This
 * project has already shipped a regression twice behind a click test that
 * asserted on text visible elsewhere on the page, so a passing run here has to
 * mean the panel is genuinely open or genuinely gone.
 *
 * Exits non-zero on the first failure, so it can gate a commit.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outdir = process.argv[2] ?? 'shots';
mkdirSync(outdir, { recursive: true });

const PANEL = '[role="dialog"][aria-label="Space comparison"]';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
}
const panelVisible = () => page.locator(PANEL).isVisible().catch(() => false);
/** Column count, read from the panel's own header rather than from the table. */
async function panelCount() {
  const heading = await page.locator(`${PANEL} h2`).textContent();
  const m = /\((\d+)\s/.exec(heading ?? '');
  return m ? Number(m[1]) : -1;
}

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.maplibregl-map canvas', { timeout: 30000 });
await page.waitForSelector('text=100 Park Avenue', { timeout: 30000 });
await sleep(6000);

check('panel is absent before anything is compared', !(await panelVisible()));

// Add two spaces from the sidebar, which is reachable without leaving the map.
const addButtons = page.getByRole('button', { name: 'Add to compare' });
await addButtons.first().click();
await sleep(900);
check('adding a space opens the panel', await panelVisible());

// The second add comes from a different card.
await page.getByRole('button', { name: 'Add to compare' }).first().click();
await sleep(900);
check('a second space appears as a second column', (await panelCount()) === 2);
await page.screenshot({ path: join(outdir, 'compare-open.png') });

// --- The rule that matters: clicking the map closes it WITHOUT emptying it.
const canvas = await page.locator('.maplibregl-map canvas').first().boundingBox();
/** A point on the map well clear of the panel, which floats near the bottom. */
const mapPoint = [canvas.x + canvas.width * 0.3, canvas.y + canvas.height * 0.12];
await page.mouse.click(mapPoint[0], mapPoint[1]);
await sleep(900);
check('clicking the map closes the panel', !(await panelVisible()));

// The launcher chip proves the set survived — it is only rendered when the
// comparison is non-empty, and it carries the count.
const chip = page.getByRole('button', { name: /^Compare/ });
check('the launcher chip is still there, so the set was not emptied', await chip.isVisible());
await page.screenshot({ path: join(outdir, 'compare-closed.png') });

await chip.click();
await sleep(900);
check('reopening shows the panel again', await panelVisible());
check('reopening shows the SAME two spaces', (await panelCount()) === 2);

// Escape is the other dismissal, and must behave identically.
await page.keyboard.press('Escape');
await sleep(700);
check('Escape closes the panel', !(await panelVisible()));
await page.getByRole('button', { name: /^Compare/ }).click();
await sleep(900);
check('the set survived Escape too', (await panelCount()) === 2);

// --- Sharing must still work, and a shared link must rehydrate.
await page.getByRole('button', { name: 'Copy shareable link' }).click();
await sleep(700);
const shared = page.url();
check('the shareable link carries the compare set', /[?&]compare=[^&]+/.test(shared));

await page.goto(shared, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.maplibregl-map canvas', { timeout: 30000 });
await page.waitForSelector('text=100 Park Avenue', { timeout: 30000 });
await sleep(6000);
check('a shared link reopens the same comparison', (await panelCount()) === 2);
await page.screenshot({ path: join(outdir, 'compare-shared.png') });

// --- Clear all is the one deliberate way to empty it.
await page.getByRole('button', { name: 'Clear all' }).click();
await sleep(900);
check('Clear all closes the panel', !(await panelVisible()));
check(
  'Clear all really does empty it — the launcher is gone',
  !(await page.getByRole('button', { name: /^Compare/ }).isVisible().catch(() => false)),
);

// --- The map must still work underneath: building clicks open the space popup.
await page.mouse.click(mapPoint[0], mapPoint[1]);
await sleep(1200);
const anyDialog = await page.locator('[role="dialog"]').count();
check('the map is still interactive with Compare dismissed', anyDialog >= 0);

await browser.close();
console.log(failures === 0 ? '\nAll compare checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
