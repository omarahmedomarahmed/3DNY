/**
 * Adding one building and one floor without a spreadsheet.
 *
 * The behaviour worth proving in a browser rather than a unit test is the
 * resolve-before-you-commit step: the form has to say whether an address is
 * one you already hold *before* anything is created, because creating a second
 * row for a tower somebody else already added under a different spelling is
 * the failure this whole flow is exposed to.
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
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 250)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) fails++; };

await page.goto('http://localhost:3111/import', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Add one by hand', { timeout: 20000 });

const address = page.getByPlaceholder('100 Park Avenue');
const addBuilding = page.getByRole('button', { name: 'Add the building only' });

check('the building button starts disabled', await addBuilding.isDisabled());

// An address already on the map.
await address.fill('100 Park Avenue');
await sleep(4000);
check('an address we already hold is recognised before anything is created',
  (await page.getByText(/Already on the map as/).count()) > 0);
check('and the create button stays disabled for it', await addBuilding.isDisabled(),
  'no second row for a tower we have');
await page.screenshot({ path: join(outdir, 'add-existing.png') });

// A real address we do not hold.
await address.fill('1350 Broadway');
await sleep(5000);
const newText = (await page.getByText(/New building/).textContent().catch(() => '')) ?? '';
check('a new address reports what it resolved to', newText.includes('New building'), newText.slice(0, 90));
check('and the create button becomes available', !(await addBuilding.isDisabled()));

// A floor can be added in the same breath.
const floor = page.getByPlaceholder('14, Partial 45th');
await floor.fill('12');
await sleep(300);
const addSpace = page.getByRole('button', { name: /Add the building and the floor|Add the floor/ });
check('the floor button is live once a floor is typed', !(await addSpace.isDisabled()));
await page.screenshot({ path: join(outdir, 'add-new.png') });

// An address that is not real.
await address.fill('9999 Nowhere Street');
await sleep(5000);
check('an address that is not real is refused, with a reason',
  (await page.getByText(/could not be|no record of|No street number/i).count()) > 0);
check('and neither button is live for it',
  (await addBuilding.isDisabled()) && (await addSpace.isDisabled()));

// The building page offers the same thing without an address.
const buildings = await (await fetch('http://localhost:3111/api/buildings')).json();
await page.goto(`http://localhost:3111/building/${buildings[0].id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1', { timeout: 20000 });
await sleep(2000);
const openForm = page.getByRole('button', { name: 'Add a space' });
check('a building page offers to add a space', (await openForm.count()) > 0);
await openForm.click();
await sleep(600);
check('and the form asks for a floor, not an address',
  (await page.getByPlaceholder('14, Partial 45th').count()) > 0 &&
  (await page.getByPlaceholder('100 Park Avenue').count()) === 0);
await page.screenshot({ path: join(outdir, 'add-space-on-building.png') });

await browser.close();
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
