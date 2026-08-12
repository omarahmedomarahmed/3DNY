import { chromium } from 'playwright';
import { openMapChrome } from './harness.mjs';
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage({ viewport:{width:1600,height:1000}});
page.on('pageerror', e=>console.log('[err]', String(e).slice(0,200)));
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const eye = async () => page.evaluate(()=>{const e=window.__explore.eye; return [Math.round(e.x),Math.round(e.y),Math.round(e.z)];});
await page.goto('http://localhost:3111/map',{waitUntil:'domcontentloaded'});
await openMapChrome(page); await sleep(5000);
await page.getByRole('button',{name:'Explore this city in 3D'}).first().click();
await sleep(8000);
// Free look on.
const free = page.getByRole('button',{name:/free look/i});
console.log('free look buttons', await free.count());
if (await free.count()) { await free.first().click(); await sleep(2500); }
const canvas = await page.locator('canvas.maplibregl-canvas').first();
const box = await canvas.boundingBox();
// Click the map to take the camera, then click again to pick what is centred.
await page.mouse.click(box.x+box.width/2, box.y+box.height/2); await sleep(1200);
await page.mouse.click(box.x+box.width/2, box.y+box.height/2); await sleep(1500);
console.log('orbit controls', await page.getByRole('button',{name:'Stop circling'}).count());
const a = await eye(); await sleep(6000); const b = await eye(); await sleep(6000); const c = await eye();
console.log('eye a', a, 'b', b, 'c', c);
await page.screenshot({path:'shots/orbit-1.png'});
await sleep(9000);
await page.screenshot({path:'shots/orbit-2.png'});
await browser.close();
