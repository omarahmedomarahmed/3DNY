/**
 * Subway entrances, framed where they are dense.
 *
 * Grand Central has more entrances in two blocks than most of Manhattan has
 * in a neighbourhood, so it is the honest place to check that they are drawn,
 * oriented to the pavement, and quiet enough not to compete with a band.
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
const press = async (name, times = 1) => {
  for (let i = 0; i < times; i++) {
    await page.getByRole('button', { name }).click();
    await sleep(420);
  }
};

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.maplibregl-map canvas', { timeout: 30000 });
await page.waitForSelector('text=100 Park Avenue', { timeout: 30000 });
await sleep(6000);

// Transit on: modelled stations, their name plates, and the walk lines from
// the selected building routed along the real streets.
await page.getByRole('button', { name: 'Show transit stops and walk times' }).click();
await sleep(3000);

// One Grand Central Place sits on top of the station complex.
await page.getByRole('button', { name: /60 E 42nd Street/ }).first().click();
await sleep(6000);
await page.screenshot({ path: join(outdir, 'stations-transit.png') });
console.log('shot stations-transit.png');

// Straight down: entrance enclosures and their orientation to the pavement.
await press('Lower the view angle', 9);
// Back off to a block or two of street: the entrances are the subject, and
// selecting a building flies close enough that its own roof fills the frame.
// One step only: two lands at zoom 15, below the threshold where entrances
// are drawn at all, which would look like a bug rather than a level of detail.
await press('Zoom out', 1);
await sleep(3500);
await page.screenshot({ path: join(outdir, 'stations-topdown.png') });
console.log('shot stations-topdown.png');

// Eye level: the globes on their posts.
await press('Raise the view angle', 6);
await sleep(3500);
await page.screenshot({ path: join(outdir, 'stations-eyelevel.png') });
console.log('shot stations-eyelevel.png');

// And close enough that an entrance is an object rather than a speck. A stair
// head is 4.6m long, which is only a couple of pixels until about zoom 17.
await press('Zoom in', 2);
await sleep(4000);
await page.screenshot({ path: join(outdir, 'stations-close.png') });
console.log('shot stations-close.png');

// Top-down with transit on: the clearest read on whether the walk routes lie
// along real streets or cut across blocks.
await press('Lower the view angle', 9);
await press('Zoom out', 1);
await sleep(4000);
await page.screenshot({ path: join(outdir, 'stations-routes-topdown.png') });
console.log('shot stations-routes-topdown.png');

await browser.close();
console.log('done');
