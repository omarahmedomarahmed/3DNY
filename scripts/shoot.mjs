/**
 * Screenshot harness for the 3DNY map. Drives the real app in headless
 * Chromium (SwiftShader GL) against the live database on :3111.
 *
 * Usage: node shoot.mjs <outdir> <prefix> [--states=all|quick]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outdir = process.argv[2] ?? 'shots';
const prefix = process.argv[3] ?? 'map';
const statesArg = (process.argv.find((a) => a.startsWith('--states=')) ?? '--states=all').split('=')[1];
mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/net::|Failed to load resource|CORS|ERR_/.test(t)) {
    console.log('[console.error]', t.slice(0, 300));
  }
});
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(name) {
  await sleep(400);
  await page.screenshot({ path: join(outdir, `${prefix}-${name}.png`) });
  console.log('shot', `${prefix}-${name}.png`);
}

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
// Wait for the map canvas and for buildings to arrive (sidebar cards render).
await page.waitForSelector('.maplibregl-map canvas', { timeout: 30000 });
await page.waitForSelector('text=100 Park Avenue', { timeout: 30000 });
await sleep(6000); // opening fitAll + context fetch + first paint

await shot('dark-wide');

// Surrounding city on — the busy frame.
await page.getByRole('button', { name: 'Show the surrounding city' }).click();
await sleep(5000);
await shot('dark-context-wide');

// Select a building: flies to zoom 17 where bands + labels live.
await page.getByRole('button', { name: /100 Park Avenue/ }).first().click();
await sleep(4500);
await shot('dark-close');

if (statesArg === 'all') {
  // Transit on.
  await page.getByRole('button', { name: 'Show transit stops and walk times' }).click();
  await sleep(5000);
  await shot('dark-close-transit');
  await page.getByRole('button', { name: 'Hide transit stops' }).click();
  await sleep(800);

  // Light theme, same close frame.
  await page.getByRole('button', { name: 'Switch to the light map' }).click();
  await sleep(4000);
  await shot('light-close');

  // Light wide.
  await page.getByRole('button', { name: 'Fit to all buildings' }).click();
  await sleep(4000);
  await shot('light-wide');

  // Back to dark for a straight-down high-pitch street-level look.
  await page.getByRole('button', { name: 'Switch to the dark map' }).click();
  await sleep(2500);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Raise the view angle' }).click();
    await sleep(500);
  }
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await sleep(3000);
  await shot('dark-street');
}

await browser.close();
console.log('done');
