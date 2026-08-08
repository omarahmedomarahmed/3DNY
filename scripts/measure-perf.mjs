/**
 * Frame rate on the frames that actually matter.
 *
 * "Performance is a feature. This runs on a broker's laptop driving a
 * projector." Headless SwiftShader is a SOFTWARE rasteriser and is far slower
 * than any real GPU, so the absolute numbers here are a pessimistic floor, not
 * a prediction — what they are good for is comparing scenes against each
 * other and catching a scene that is catastrophically heavier than its
 * neighbours.
 *
 * Frames are counted during a continuous camera movement, because a still map
 * costs nothing and tells you nothing.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Counts animation frames over a window while the map is being rotated, and
 * reports the mean interval as well as the worst single frame — a scene that
 * averages well but stutters is still a scene that loses the room.
 */
async function measure(label) {
  const stats = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const times = [];
        let last = performance.now();
        const started = last;
        function tick(now) {
          times.push(now - last);
          last = now;
          if (now - started < 4000) requestAnimationFrame(tick);
          else {
            times.sort((a, b) => a - b);
            const mean = times.reduce((s, t) => s + t, 0) / times.length;
            resolve({
              frames: times.length,
              fps: 1000 / mean,
              p95Ms: times[Math.floor(times.length * 0.95)] ?? 0,
              worstMs: times[times.length - 1] ?? 0,
            });
          }
        }
        requestAnimationFrame(tick);
      }),
  );
  console.log(
    `${label.padEnd(34)} ${stats.fps.toFixed(1).padStart(5)} fps   ` +
      `p95 ${stats.p95Ms.toFixed(0).padStart(4)}ms   worst ${stats.worstMs.toFixed(0)}ms`,
  );
  return stats;
}

/** Keeps the camera moving for the duration of a measurement. */
async function spin(seconds) {
  const end = Date.now() + seconds * 1000;
  void (async () => {
    while (Date.now() < end) {
      await page.getByRole('button', { name: 'Rotate right' }).click().catch(() => {});
      await sleep(420);
    }
  })();
}

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.maplibregl-map canvas', { timeout: 30000 });
await page.waitForSelector('text=100 Park Avenue', { timeout: 30000 });
await sleep(7000);

console.log('\nSoftware rasteriser (SwiftShader) — a pessimistic floor, not a prediction.\n');

await spin(5);
await measure('clean map, wide');

await page.getByRole('button', { name: /100 Park Avenue/ }).first().click();
await sleep(6000);
await spin(5);
await measure('clean map, close (bands + roofs)');

await page.getByRole('button', { name: 'Show the surrounding city' }).click();
await sleep(7000);
await spin(5);
await measure('whole city + roofs, close');

await page.getByRole('button', { name: 'Show transit stops and walk times' }).click();
await sleep(6000);
await spin(5);
await measure('whole city + roofs + transit');

// The heaviest thing the map can be asked to draw: everything, at the zoom
// where trees, entrances and painted street names are all switched on.
await page.getByRole('button', { name: 'Zoom in' }).click();
await sleep(6000);
await spin(5);
await measure('everything, street level');

await browser.close();
console.log('');
