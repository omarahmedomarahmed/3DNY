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
await page.screenshot({ path: 'shots/tenant-import.png' });

// --- The map: three kinds, filterable, clickable.
await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=100 Park Avenue', { timeout: 30000 });
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
  await page.screenshot({ path: 'shots/tenant-card.png' });
}
await browser.close();
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
