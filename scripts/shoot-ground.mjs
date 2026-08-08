/**
 * Ground-plane close-ups: looking straight down and from a low angle, where
 * the streets, kerbs, pavements and painted names fill the frame. The general
 * harness frames buildings; this one frames what they stand on.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outdir = process.argv[2] ?? 'shots';
const prefix = process.argv[3] ?? 'ground';
mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(name) {
  await sleep(400);
  await page.screenshot({ path: join(outdir, `${prefix}-${name}.png`) });
  console.log('shot', `${prefix}-${name}.png`);
}

/**
 * Drives the camera through the app's own controls rather than a private map
 * handle — which also exercises the controls themselves.
 */
async function press(label, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.getByRole('button', { name: label }).click();
    await sleep(450);
  }
}

/** Flattens the pitch to straight down, from wherever it currently is. */
async function topDown() {
  await press('Lower the view angle', 9);
  await sleep(2500);
}

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.maplibregl-map canvas', { timeout: 30000 });
await page.waitForSelector('text=100 Park Avenue', { timeout: 30000 });
await sleep(7000);

// Select a building so the camera sits over Midtown at street-reading zoom,
// then flatten: nothing but ground in frame.
await page.getByRole('button', { name: /100 Park Avenue/ }).first().click();
await sleep(4500);
await topDown();
await shot('dark-topdown');

// Low and close: kerb height, pavement width, names on the asphalt.
await press('Raise the view angle', 7);
await press('Zoom in', 1);
await sleep(2500);
await shot('dark-lowangle');

await page.getByRole('button', { name: 'Switch to the light map' }).click();
await sleep(3000);
await topDown();
await shot('light-topdown');

await browser.close();
console.log('done');
