/**
 * Drives the whole Salesforce flow in a real browser, against the stand-in org.
 *
 * This project's rule is that anything you can see is proven in a browser, and
 * that a passing unit test is not the same as a working feature. The mapping
 * and parsing are unit-tested; what is checked here is the part a person
 * actually does:
 *
 *   connection reads as connected → choose a report from the list →
 *   the suggested mapping is right → preview shows real converted rows →
 *   save → sync → the spaces are on the map, with the right count
 *
 * Run:
 *   node scripts/fake-salesforce.mjs 4599 &
 *   SALESFORCE_INSTANCE_URL=http://localhost:4599 \
 *   SALESFORCE_CLIENT_ID=x SALESFORCE_CLIENT_SECRET=y npm run dev &
 *   node scripts/verify-salesforce.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SF = process.env.SALESFORCE_STUB_URL ?? 'http://localhost:4599';
const SHOTS = 'shots';
const problems = [];

const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) problems.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

try {
  // Start from nothing bound. Without this the second run picks up the first
  // run's bindings, the buttons say "Change report" instead of "Choose a
  // report", and every locator below lands on the wrong card.
  for (const kind of ['spaces', 'occupiers', 'clients']) {
    await fetch(`${BASE}/api/salesforce/feeds?kind=${kind}`, { method: 'DELETE' });
  }
  await fetch(`${SF}/__control`);

  // --- Connection --------------------------------------------------------
  await page.goto(`${BASE}/setup`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Salesforce', { timeout: 30000 });
  await page.waitForTimeout(2500);

  const connected = await page.locator('text=/Connected as/i').count();
  check(connected > 0, 'the connection card reads as connected');
  check(
    (await page.locator('text=integration@cresa.example').count()) > 0,
    'it names the run-as user, so a wrong org is obvious',
  );

  await page.screenshot({ path: `${SHOTS}/salesforce-1-connected.png`, fullPage: true });

  // --- Choosing a report -------------------------------------------------
  // Scoped to the card, not `.first()`: three feeds carry the same buttons,
  // and once one is bound its label changes, so an unscoped locator silently
  // starts driving a different feed.
  const spaces = page.locator('[data-feed="spaces"]');
  await spaces.getByRole('button', { name: /Choose a report/ }).click();
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await page.waitForTimeout(1500);

  const listed = await page.locator('[role="dialog"] li').count();
  check(listed === 4, 'every report the user can see is listed', `${listed} shown`);

  // The search box is the whole point of a list rather than a dropdown.
  await page.locator('[role="dialog"] input').fill('available');
  await page.waitForTimeout(300);
  check(
    (await page.locator('[role="dialog"] li').count()) === 1,
    'searching narrows the list',
  );

  await page.screenshot({ path: `${SHOTS}/salesforce-2-report-picker.png` });
  await page.getByRole('button', { name: /Available Spaces/ }).click();
  await page.waitForTimeout(3000);

  // --- The mapping -------------------------------------------------------
  const mapping = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll('select').forEach((s) => {
      const row = s.closest('tr');
      const label = row?.querySelector('td span')?.textContent?.trim();
      if (label) out[label] = s.options[s.selectedIndex]?.text ?? '';
    });
    return out;
  });

  // The trap this integration has to survive: "Building" and "Building
  // Address" both exist, and getting them the wrong way round pins every
  // space to a name instead of a street.
  check(
    mapping['Building address'] === 'Building Address',
    'the address maps to the address column, not the building name',
    `got "${mapping['Building address']}"`,
  );
  check(
    mapping['Building name'] === 'Building',
    'the building name takes the column left over',
    `got "${mapping['Building name']}"`,
  );
  check(mapping.Floor === 'Floor', 'the floor is mapped');
  check(mapping['Square feet'] === 'Available SF', 'SF is mapped');
  check(mapping['Asking rent'] === 'Asking Rent', 'rent is mapped');

  // Scoped to the card: once a run has happened the page also carries the
  // sync-history table, and `.last()` would read that instead.
  const previewText = await spaces.locator('table').last().innerText();
  check(
    previewText.includes('60 E 42nd Street'),
    'the preview shows a converted address from the org’s own rows',
  );
  check(
    !previewText.includes('One Grand Central Place'),
    'the building NAME is not sitting in the address column',
  );
  check(
    (await page.locator('text=/could not be placed/').count()) > 0,
    'the row with no floor is reported, not silently dropped',
  );

  await page.screenshot({ path: `${SHOTS}/salesforce-3-mapping.png`, fullPage: true });

  // --- Save and sync -----------------------------------------------------
  await spaces.getByRole('button', { name: 'Save this mapping' }).click();
  await page.waitForTimeout(2500);
  check(
    (await page.locator('text=/Mapping saved/').count()) > 0,
    'the mapping saves',
  );

  await spaces.getByRole('button', { name: 'Sync now' }).click();
  await page.waitForTimeout(20000);

  const summary = await page.locator('text=/rows read/').first().textContent().catch(() => '');
  check(Boolean(summary), 'the sync reports what it did', summary ?? 'no summary');
  check(
    /5 rows read/.test(summary ?? ''),
    'it read every row in the report',
    summary ?? '',
  );
  check(
    /1 skipped/.test(summary ?? ''),
    'the floorless row is counted as skipped rather than imported',
    summary ?? '',
  );

  await page.screenshot({ path: `${SHOTS}/salesforce-4-synced.png`, fullPage: true });

  // --- Did it actually reach the map? ------------------------------------
  const onMap = await page.evaluate(async () => {
    const res = await fetch('/api/buildings', { cache: 'no-store' });
    const body = await res.json();
    const list = Array.isArray(body) ? body : (body.buildings ?? []);
    const hit = list.find((b) => b.address_display?.includes('60 E 42nd'));
    return {
      total: list.length,
      grandCentralFloors: (hit?.spaces ?? [])
        .filter((s) => s.is_active)
        .map((s) => s.floor_label),
    };
  });

  check(
    onMap.grandCentralFloors.includes('14') && onMap.grandCentralFloors.includes('22'),
    'both synced floors are on the building',
    onMap.grandCentralFloors.join(', '),
  );

  // --- The run history ---------------------------------------------------
  check(
    (await page.locator('text=Recent syncs').count()) > 0,
    'the run is recorded in the history',
  );

  // --- A floor comes off the market --------------------------------------
  // The behaviour the whole feature exists for, and the one that can do the
  // most damage if it is wrong: floor 22 leaves the report, so it must leave
  // the map — and nothing that arrived from a landlord feed may go with it.
  const before = await page.evaluate(async () => {
    const res = await fetch('/api/buildings', { cache: 'no-store' });
    const body = await res.json();
    const list = Array.isArray(body) ? body : (body.buildings ?? []);
    const hit = list.find((b) => b.address_display?.includes('60 E 42nd'));
    return (hit?.spaces ?? []).filter((s) => s.is_active).map((s) => s.floor_label);
  });

  await fetch(`${SF}/__control?drop=22`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await spaces.getByRole('button', { name: 'Sync now' }).click();
  await page.waitForTimeout(20000);

  const after = await page.evaluate(async () => {
    const res = await fetch('/api/buildings', { cache: 'no-store' });
    const body = await res.json();
    const list = Array.isArray(body) ? body : (body.buildings ?? []);
    const hit = list.find((b) => b.address_display?.includes('60 E 42nd'));
    return (hit?.spaces ?? []).filter((s) => s.is_active).map((s) => s.floor_label);
  });

  check(!after.includes('22'), 'a floor dropped from the report leaves the map', after.join(', '));
  check(after.includes('14'), 'a floor still in the report stays');

  const landlordSpaces = before.filter((f) => !['14', '22'].includes(f));
  check(
    landlordSpaces.every((f) => after.includes(f)),
    'spaces from the landlord feeds are untouched by a CRM sync',
    `kept ${after.filter((f) => landlordSpaces.includes(f)).length}/${landlordSpaces.length}`,
  );

  check(
    (await page.locator('text=/What changed/').count()) > 0,
    'the run history offers the list of what was taken off',
  );
  await page.getByRole('button', { name: 'What changed' }).first().click();
  await page.waitForTimeout(400);
  await page.waitForTimeout(500);
  check(
    (await page.locator('text=/60 E 42nd Street — floor 22/').count()) > 0,
    'it names the floor it retired, rather than only counting it',
  );

  await page.screenshot({ path: `${SHOTS}/salesforce-5-retired.png`, fullPage: true });

  // --- A truncated read must never retire --------------------------------
  // Salesforce caps a report at 2,000 rows. Concluding that everything past
  // that has come off the market would empty a third of the map.
  await fetch(`${SF}/__control?drop=14,22,31,63&truncate=1`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await spaces.getByRole('button', { name: 'Sync now' }).click();
  await page.waitForTimeout(20000);

  const truncated = await page.evaluate(async () => {
    const res = await fetch('/api/buildings', { cache: 'no-store' });
    const body = await res.json();
    const list = Array.isArray(body) ? body : (body.buildings ?? []);
    const hit = list.find((b) => b.address_display?.includes('60 E 42nd'));
    return (hit?.spaces ?? []).filter((s) => s.is_active).map((s) => s.floor_label);
  });
  check(
    truncated.includes('14'),
    'a truncated report retires nothing, even though the rows are missing from it',
    truncated.join(', '),
  );

  await fetch(`${SF}/__control`);
  check(pageErrors.length === 0, 'no page errors', pageErrors.join(' | '));
} catch (err) {
  problems.push(`threw: ${err.message}`);
  await page.screenshot({ path: `${SHOTS}/salesforce-error.png`, fullPage: true }).catch(() => {});
  console.error(err);
} finally {
  await browser.close();
}

console.log(problems.length === 0 ? '\nAll checks passed.' : `\n${problems.length} problem(s).`);
process.exit(problems.length === 0 ? 0 : 1);
