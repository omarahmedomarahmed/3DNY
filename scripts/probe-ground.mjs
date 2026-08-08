/** Reports what the streetscape API is asked for, and what it returns, as the
 * camera moves from the opening frame to a selected building. */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

page.on('response', async (res) => {
  const u = res.url();
  if (!u.includes('/api/streetscape')) return;
  let info = '';
  try {
    const j = await res.json();
    info = `roads=${j.roads?.length} water=${j.water?.length}`;
  } catch {
    info = '(unparsed)';
  }
  console.log(res.status(), u.split('?')[1], info);
});

await page.goto('http://localhost:3111/map', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.maplibregl-map canvas', { timeout: 30000 });
await page.waitForSelector('text=100 Park Avenue', { timeout: 30000 });
await sleep(7000);
console.log('--- selecting a building ---');
await page.getByRole('button', { name: /100 Park Avenue/ }).first().click();
await sleep(7000);
await browser.close();
