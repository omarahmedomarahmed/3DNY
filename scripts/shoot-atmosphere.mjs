/**
 * The four hours of the day, from one fixed camera.
 *
 * The frame deliberately includes distance, so haze is visible, AND a
 * selected building with an availability band, so the hierarchy rule can be
 * checked at every hour rather than only at the one that happened to be on
 * screen. If a band stops being the loudest thing in any of these, the
 * atmosphere pass has failed regardless of how good the sky looks.
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

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.maplibregl-map canvas', { timeout: 30000 });
await page.waitForSelector('text=100 Park Avenue', { timeout: 30000 });
await sleep(6000);

// Surrounding city on, a building selected, and a low camera — the busiest,
// most distance-heavy frame this map produces.
await page.getByRole('button', { name: 'Show the surrounding city' }).click();
await sleep(4000);
await page.getByRole('button', { name: /100 Park Avenue/ }).first().click();
await sleep(4500);
for (let i = 0; i < 3; i++) {
  await page.getByRole('button', { name: 'Raise the view angle' }).click();
  await sleep(400);
}
await sleep(3000);

// Cycle the hours. The button reports the hour it is currently showing, so
// its label is read back to name each file honestly.
for (let i = 0; i < 4; i++) {
  const btn = page.getByRole('button', { name: /^Time of day:/ });
  const label = (await btn.getAttribute('aria-label')) ?? '';
  const hour = (/Time of day: ([^.]+)\./.exec(label)?.[1] ?? `hour-${i}`)
    .toLowerCase()
    .replace(/\s+/g, '-');
  await page.screenshot({ path: join(outdir, `atmos-${hour}.png`) });
  console.log('shot', `atmos-${hour}.png`);
  await btn.click();
  await sleep(3500);
}

await browser.close();
console.log('done');
