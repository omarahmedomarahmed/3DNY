/**
 * The three kinds of band, and the two ways tenant data gets in.
 *
 * What this exists to catch is the thing unit tests cannot: that the new bands
 * are reachable, clickable and filterable on the real map, and that
 * availability keeps the position the whole map is built around — it is the
 * one kind that cannot be switched off.
 *
 * It also checks that an unconfigured Salesforce fails usefully. A CRM
 * integration that is not set up is the normal state on day one, and "Sync
 * failed" with no remedy is how someone concludes the feature is broken rather
 * than unconfigured.
 */
import { chromium } from 'playwright';
import { openMapChrome, openFilters } from './harness.mjs';
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
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) fails++; };

// --- The import page offers both sheets and the CRM.
await page.goto('http://localhost:3111/import', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Tenants and clients', { timeout: 20000 });
check('the import page offers a tenant roster and a client sheet',
  (await page.getByRole('button', { name: 'Tenant roster' }).count()) > 0 &&
  (await page.getByRole('button', { name: 'Cresa clients' }).count()) > 0);
await page.getByRole('button', { name: 'Check without writing' }).click();
await sleep(2500);
const notConfigured = await page.getByText(/not configured/i).count();
check('an unconfigured Salesforce says so and points at the CSV path', notConfigured > 0);
const remedy = await page.getByText(/use the tenant CSV import/i).count();
check('and the error carries a remedy, not just a failure', remedy > 0);
await page.screenshot({ path: join(outdir, 'tenant-import.png') });

// --- The map: three kinds, filterable, clickable.
await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await openMapChrome(page);
await sleep(6000);
check('the legend lists all three band kinds',
  (await page.getByRole('button', { name: /available space on the towers/ }).count()) > 0 &&
  (await page.getByRole('button', { name: /Cresa client space on the towers/ }).count()) > 0 &&
  (await page.getByRole('button', { name: /occupied space on the towers/ }).count()) > 0);

const availBtn = page.getByRole('button', { name: /available space on the towers/ }).first();
check('availability cannot be switched off', await availBtn.isDisabled());

await page.getByRole('button', { name: /100 Park Avenue/ }).first().click();
await sleep(6000);
await page.keyboard.press('Escape');
await sleep(500);

// Turn the tenant bands on, then click one.
await page.getByRole('button', { name: /Show Cresa client space on the towers/ }).first().click();
await sleep(800);
await page.getByRole('button', { name: /Show occupied space on the towers/ }).first().click();
await sleep(3000);

const box = await page.locator('.maplibregl-map canvas').first().boundingBox();
let opened = 0;
// Sweep a short vertical line up the middle of the selected tower.
for (let f = 0.30; f <= 0.62 && !opened; f += 0.012) {
  await page.mouse.click(box.x + box.width * 0.47, box.y + box.height * f);
  await sleep(400);
  opened = await page.locator('[role="dialog"][aria-label$="tenancy details"]').count();
}
check('clicking a tenant band opens its card', opened > 0);
if (opened) {
  const text = (await page.locator('[role="dialog"][aria-label$="tenancy details"]').first().textContent()) ?? '';
  check('the card names the company and its relationship', /Occupier|Prospect|Cresa client/.test(text), text.replace(/\s+/g, ' ').slice(0, 90));
  check('and it carries a source marker',
    (await page.getByRole('button', { name: 'Where this tenancy came from' }).count()) > 0);
  await page.screenshot({ path: join(outdir, 'tenant-card.png') });
}
// --- A tenant name is a way into the map ---------------------------------

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await openMapChrome(page);
// The search box lives in the filter rail, which no longer opens by default.
await openFilters(page);
await sleep(6000);
/**
 * The name searched for is read out of the data, not written into the test.
 *
 * It used to be the literal string "Kestrel", which was a company in the
 * synthetic fixture and is therefore an assertion about the fixture rather
 * than about the search. The moment the fixture became a snapshot of the real
 * market the check failed while the search worked perfectly. Asking the API
 * which tenant is in which building makes the same check independent of whose
 * data is loaded — and stronger, because it now verifies that the building the
 * search lands on is the one that tenant is actually in.
 */
const target = await page.evaluate(async () => {
  const res = await fetch('/api/buildings');
  const buildings = await res.json();
  for (const b of buildings) {
    const t = (b.tenants ?? [])[0];
    if (t?.company_name && b.address_display) {
      return { company: t.company_name, address: b.address_display };
    }
  }
  return null;
});
check('the data has a tenancy to search for', target !== null, target?.company ?? 'none');

if (target) {
  const before = await page.locator('article').count();
  // The first word only: a search that has to match punctuation and casing
  // exactly is testing the fixture's spelling, not the search.
  await page.getByPlaceholder(/Address, building, tenant/).fill(target.company.split(' ')[0]);
  await sleep(2000);
  const after = await page.locator('article').count();
  check('searching a tenant name narrows the list', after > 0 && after < before, `${before} → ${after}`);
  check('and lands on the building that tenant is in',
    (await page.getByText(target.address).count()) > 0, target.address);
}
await page.getByPlaceholder(/Address, building, tenant/).fill('');
await sleep(1500);

// --- Compare answers "what else is in that tower" -------------------------

const add = page.getByRole('button', { name: /^Add to compare$/ });
for (let i = 0; i < 2; i++) { await add.nth(0).click(); await sleep(700); }
await sleep(6000);
for (const label of ['Our clients here', 'Tenants recorded', 'Leases rolling in 12 mo']) {
  const row = page.locator('tr', { has: page.locator('th', { hasText: label }) }).first();
  const found = await row.count();
  if (found) await row.scrollIntoViewIfNeeded();
  check(`compare has a "${label}" row`, found > 0);
}
await page.screenshot({ path: join(outdir, 'compare-occupancy.png') });

// --- The building profile speaks the same language as the map -------------

const all = await (await fetch('http://localhost:3111/api/buildings')).json();
const undrawable = all.find((b) =>
  (b.tenants ?? []).some((t) => (t.floor_numbers ?? []).length === 0),
);
if (undrawable) {
  await page.goto(`http://localhost:3111/building/${undrawable.id}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('h1', { timeout: 20000 });
  await sleep(2500);
  check('the tenant table shows a relationship',
    (await page.getByText(/Occupier|Prospect|Cresa client/).count()) > 0);
  // The one place someone would find out why a tenancy they can see in the
  // table is not on the tower.
  check('and says when a tenancy cannot be drawn',
    (await page.getByText('not on the map').count()) > 0);
  await page.screenshot({ path: join(outdir, 'tenant-table.png') });
}

await browser.close();
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
