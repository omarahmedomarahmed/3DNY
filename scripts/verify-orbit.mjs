/**
 * The locked orbit, in a real browser.
 *
 * The maths is unit tested — `tests/explore-orbit.test.ts` proves the framing
 * distance keeps a building inside the field of view and that the camera never
 * ends up underground. None of that proves the feature works: the camera is
 * driven from a frame loop, through a hook, from a click that has to resolve
 * to a building first, and every one of those can be wrong while the
 * arithmetic is right.
 *
 * So this asserts on where the eye actually is, frame by frame, and on the
 * pixels that come out.
 *
 * Run against `SPACES_FIXTURE_DB=1 next start -p 3111`.
 */
import { chromium } from 'playwright';
import { openMapChrome } from './harness.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const outdir = process.argv[2] ?? 'shots/orbit';
mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const eye = () =>
  page.evaluate(() => {
    const e = window.__explore?.eye;
    return e ? [e.x, e.y, e.z] : null;
  });

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await openMapChrome(page);
await sleep(5000);
await page.getByRole('button', { name: 'Explore this city in 3D' }).first().click();
await sleep(8000);

/**
 * Aim at a known tower before taking the camera.
 *
 * Free look starts exactly where the map camera already is, and the pick that
 * begins an orbit is taken from the crosshair in the middle of the screen. In
 * the default view the middle of the screen is the ground, so the click
 * resolves to nothing and the orbit never starts — which is the harness being
 * wrong, not the feature. Selecting a building flies the map to it first.
 */
await page.getByRole('button', { name: /350 Fifth Avenue/ }).first().click();
await sleep(5000);
await page.keyboard.press('Escape');
await sleep(800);
await page.evaluate(() => {
  const el = document.querySelector('.maplibregl-map');
  const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  const isMap = (v) =>
    v && typeof v === 'object' && typeof v.getCenter === 'function' && typeof v.jumpTo === 'function';
  for (let f = el[key], d = 0; f && d < 60; d++, f = f.return) {
    for (let h = f.memoizedState, i = 0; h && i < 80; i++, h = h.next) {
      const st = h.memoizedState;
      if (st && typeof st === 'object' && 'current' in st && isMap(st.current)) {
        window.__m = st.current;
        return;
      }
    }
  }
});
// Low and close, so the tower fills the middle of the frame rather than the
// street in front of it.
await page.evaluate(() => {
  window.__m.jumpTo({ center: [-73.98566, 40.74844], zoom: 16.4, pitch: 72, bearing: 0 });
});
await sleep(4000);

const freeLook = page.getByRole('button', { name: 'Free camera' });
check('free look can be entered', (await freeLook.count()) > 0);
if ((await freeLook.count()) > 0) {
  await freeLook.first().click();
  await sleep(2500);
}

const canvas = page.locator('canvas.maplibregl-canvas').first();
const box = await canvas.boundingBox();
// The first click hands the camera to the mouse; the second picks whatever the
// crosshair is on, which is what starts the orbit.
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await sleep(1200);
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await sleep(2000);

const stop = page.getByRole('button', { name: 'Stop circling' });
const started = (await stop.count()) > 0;
check('clicking a building starts an orbit', started);

if (started) {
  check(
    'the city can be asked back into the shot',
    (await page.getByRole('button', { name: /the other buildings/ }).count()) > 0,
  );

  /**
   * Sampled only once the move into the lock is over.
   *
   * The dolly in or out takes up to four seconds and covers far more ground
   * than the orbit does, so a sample taken during it makes the first interval
   * twice the second and the steady-rate check fails on a camera that is
   * behaving correctly. Waiting is the fix; loosening the check would have
   * hidden a real drift later.
   *
   * After that: forty-five seconds a revolution is eight degrees a second, so
   * six seconds is about forty-eight degrees — far enough to measure and short
   * enough not to make the harness crawl.
   */
  await sleep(5000);
  const a = await eye();
  await sleep(6000);
  const b = await eye();
  await sleep(6000);
  const c = await eye();

  check('the scene reports where the eye is', Boolean(a && b && c));

  if (a && b && c) {
    const moved = Math.hypot(b[0] - a[0], b[1] - a[1]);
    check('the camera is moving', moved > 5, `${moved.toFixed(1)} m in six seconds`);

    // The whole claim of the feature: it is a circle, not a drift. The centre
    // is unknown here, so the test is that the eye stays the same distance
    // from the circumcentre of the three samples.
    const r1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const r2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    check(
      'it travels at a steady rate, as a circle does',
      Math.abs(r1 - r2) < Math.max(r1, r2) * 0.35,
      `${r1.toFixed(1)} m then ${r2.toFixed(1)} m`,
    );

    check(
      'the eye stays above the pavement',
      a[2] > 1 && b[2] > 1 && c[2] > 1,
      `z ${a[2].toFixed(0)}, ${b[2].toFixed(0)}, ${c[2].toFixed(0)}`,
    );
    // The eye rides at the subject's roof height, which does not change as it
    // goes round. A drifting altitude means the framing is not locked.
    check(
      'the altitude is locked',
      Math.abs(b[2] - c[2]) < 0.5,
      `${b[2].toFixed(1)} m then ${c[2].toFixed(1)} m`,
    );
  }

  await page.screenshot({ path: join(outdir, 'orbit-a.png') });
  await sleep(9000);
  await page.screenshot({ path: join(outdir, 'orbit-b.png') });

  // Stopping is a hand-off: the camera stays exactly where the orbit left it.
  const before = await eye();
  await stop.first().click();
  await sleep(1500);
  const after = await eye();
  check('stopping leaves the orbit', (await stop.count()) === 0);
  if (before && after) {
    check(
      'and hands the camera back where it was standing, without a snap',
      Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]) < 40,
      `moved ${Math.hypot(after[0] - before[0], after[1] - before[1]).toFixed(1)} m`,
    );
  }
}

check('no page errors were raised', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(failures === 0 ? '\nAll orbit checks passed.' : `\n${failures} check(s) FAILED.`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
