/**
 * Stack Snapshot, produced for real and inspected.
 *
 * Two things had gone wrong that only looking at the file would catch: the
 * picture was low resolution, and every sheet carried a band of dead space
 * across the bottom where the layout took its height from the capture rather
 * than the other way round.
 *
 * This drives the real button, intercepts the download, and checks the actual
 * PNG — its pixel size, and whether its bottom edge is a flat empty strip.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const outdir = process.argv[2] ?? 'shots';
mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  acceptDownloads: true,
});
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.maplibregl-map canvas', { timeout: 30000 });
await page.waitForSelector('text=100 Park Avenue', { timeout: 30000 });
await sleep(6000);

await page.getByRole('button', { name: /100 Park Avenue/ }).first().click();
await sleep(6000);

const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
await page.getByRole('button', { name: /Stack snapshot/ }).click();
const download = await downloadPromise;
const file = join(outdir, 'snapshot.png');
await download.saveAs(file);
console.log('saved', file);

// No image library is available here, so the PNG is measured back inside the
// browser: loaded into a canvas, then sampled.
const measured = await page.evaluate(async (src) => {
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = src;
  });
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);

  /** Mean colour and variance of a horizontal strip, over the picture half. */
  function strip(y, h, x0, x1) {
    const d = ctx.getImageData(x0, y, x1 - x0, h).data;
    let sum = 0;
    const values = [];
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
      values.push(v);
      sum += v;
    }
    const mean = sum / values.length;
    let varSum = 0;
    for (const v of values) varSum += (v - mean) ** 2;
    return { mean, sd: Math.sqrt(varSum / values.length) };
  }

  const pictureRight = Math.floor(img.height); // the picture half is a square
  return {
    width: img.width,
    height: img.height,
    bottom: strip(img.height - 40, 30, 10, Math.min(pictureRight - 10, img.width - 10)),
    middle: strip(Math.floor(img.height * 0.5), 30, 10, Math.min(pictureRight - 10, img.width - 10)),
  };
}, `data:image/png;base64,${readFileSync(file).toString('base64')}`);

console.log('  image', `${measured.width}x${measured.height}`);
console.log(
  '  bottom strip',
  `mean ${measured.bottom.mean.toFixed(1)} sd ${measured.bottom.sd.toFixed(1)}`,
);
console.log(
  '  middle strip',
  `mean ${measured.middle.mean.toFixed(1)} sd ${measured.middle.sd.toFixed(1)}`,
);

// The sheet is cut to its content, so its absolute height varies with how
// many availabilities the building has. What must hold is the DENSITY: the
// picture is a square as tall as the sheet, and both are composed at 2x, so a
// sheet is never a screenshot-sized image.
// The panel is 560 layout units wide and the picture is a square as tall as
// the sheet, so at 2x composition the width must lead the height by exactly
// 1120 pixels. That single equality pins both the 2x scale and the layout —
// composed 1:1 the gap would be 560.
check(
  'the sheet is composed at 2x, not screenshot-sized',
  measured.width - measured.height === 1120,
  `${measured.width}x${measured.height}, gap ${measured.width - measured.height}`,
);

// A flat filler band has essentially no variation. Real map pixels do.
check(
  'the bottom of the picture is map, not a blank filler band',
  measured.bottom.sd > 4,
  `sd ${measured.bottom.sd.toFixed(1)} (flat fill would be ~0)`,
);

await browser.close();
console.log(failures === 0 ? '\nAll snapshot checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
