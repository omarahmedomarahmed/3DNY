/**
 * A look at Explore mode, from the angles it is judged on.
 *
 * `verify-explore.mjs` asserts; this one only looks. It exists because the
 * kill criteria in the plan are visual and the fastest way to answer "does
 * this read as VU.CITY" is a handful of frames from the places a broker would
 * actually put the camera.
 */
import { chromium } from 'playwright';
import { openMapChrome } from './harness.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outdir = process.argv[2] ?? 'shots/look';
mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 240)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await openMapChrome(page);
await sleep(6000);
await page.evaluate(() => {
  const el = document.querySelector('.maplibregl-map');
  const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  const isMap = (v) =>
    v && typeof v === 'object' && typeof v.getCenter === 'function' && typeof v.jumpTo === 'function';
  for (let f = el[key], d = 0; f && d < 60; d++, f = f.return)
    for (let h = f.memoizedState, i = 0; h && i < 80; i++, h = h.next) {
      const s = h.memoizedState;
      if (s && typeof s === 'object' && 'current' in s && isMap(s.current)) { window.__m = s.current; return; }
    }
});

await page.getByRole('button', { name: 'Explore this city in 3D' }).first().click();
await sleep(5000);
await page.getByRole('button', { name: 'Show the surrounding city' }).first().click();
await sleep(12000);

/** hour label → how many clicks of the time button from wherever we are. */
async function setHour(name) {
  for (let i = 0; i < 5; i++) {
    const label = (await page.getByRole('button', { name: /^Time of day:/ }).getAttribute('aria-label')) ?? '';
    if (new RegExp(name, 'i').test(label)) return;
    await page.getByRole('button', { name: /^Time of day:/ }).click();
    await sleep(1800);
  }
}

const SHOTS = [
  ['skyline-morning', { center: [-73.9800, 40.7520], zoom: 14.6, pitch: 76, bearing: -28 }, 'Morning'],
  ['skyline-golden', { center: [-73.9800, 40.7520], zoom: 14.6, pitch: 76, bearing: -28 }, 'Golden'],
  ['skyline-night', { center: [-73.9800, 40.7520], zoom: 14.6, pitch: 76, bearing: -28 }, 'Night'],
  ['avenue', { center: [-73.9840, 40.7540], zoom: 17.2, pitch: 80, bearing: 29 }, 'Morning'],
  ['hero', { center: [-73.98566, 40.74844], zoom: 16.2, pitch: 70, bearing: 12 }, 'Morning'],
  ['downtown', { center: [-74.0100, 40.7100], zoom: 15.0, pitch: 78, bearing: -40 }, 'Morning'],
];

for (const [name, camera, hour] of SHOTS) {
  await setHour(hour);
  await page.evaluate((c) => window.__m.jumpTo(c), camera);
  // The streetscape for a new viewport is a live fetch from NYC Open Data and
  // then a full rebuild of the roadbed; five seconds was not enough on this
  // container and the frames came out with no streets in them.
  await sleep(16000);
  await page.screenshot({ path: join(outdir, `${name}.png`) });
  console.log(`  ${name}`);
}

/**
 * Free look, which is the only camera in this product that can point above the
 * horizon. Driven straight through the layer rather than through the mouse:
 * pointer lock does not exist in a headless browser, and what is being looked
 * at here is the projection, not the input handling.
 */
await setHour('Morning');
/**
 * The map camera is parked over Midtown first, and that is not cosmetic.
 * The streetscape and the surrounding city are still keyed to MapLibre's
 * viewport while free look is on (decision #89), so a free camera flown
 * somewhere the map camera never went arrives over loaded buildings and
 * unloaded ground.
 */
await page.evaluate(() => window.__m.jumpTo({ center: [-73.9840, 40.7540], zoom: 15.4, pitch: 60, bearing: 20 }));
await sleep(18000);
await page.getByRole('button', { name: 'Free camera' }).first().click();
await sleep(2000);

/**
 * Scene metres from the layer's anchor: +X east, +Y north, +Z up. The map
 * camera above is parked at roughly (0, 480), so these all sit within the
 * loaded streetscape.
 */
const FREE = [
  // Standing in the street: the roadbed, the kerbs, the traffic and the
  // pedestrians at the height a person sees them.
  ['free-street', { x: -60, y: 420, z: 1.7, yaw: 205, pitch: 2 }],
  // The same spot, looking up the facade — the shot MapLibre's camera cannot
  // take at all, at any setting.
  ['free-lookup', { x: -60, y: 420, z: 6, yaw: 205, pitch: 52 }],
  // Straight up at the sky, to see the cloud cover.
  ['free-zenith', { x: -60, y: 420, z: 30, yaw: 205, pitch: 88 }],
  // High and looking down over the model.
  ['free-above', { x: 0, y: 100, z: 900, yaw: 8, pitch: -42 }],
  // Low over the streets, looking along an avenue.
  ['free-avenue', { x: 0, y: 900, z: 40, yaw: 190, pitch: -6 }],
];

for (const [name, cam] of FREE) {
  await page.evaluate((c) => window.__explore.setFreeCamera(c), cam);
  await sleep(4000);
  await page.screenshot({ path: join(outdir, `${name}.png`) });
  console.log(`  ${name}`);
}

await browser.close();
console.log(`\nWrote ${SHOTS.length + FREE.length} frames to ${outdir}.`);
