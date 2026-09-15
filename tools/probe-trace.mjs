import { chromium } from '@playwright/test';
const url = process.argv[2] || 'http://127.0.0.1:4173/world.html';
const seconds = Number(process.argv[3] || 90);
const browser = await chromium.launch({ headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--disable-dawn-features=disallow_unsafe_apis', '--window-size=1600,1000'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto(url);
await page.waitForSelector('#loading[hidden]', { state: 'attached', timeout: 240000 });
if (process.argv[4]) await page.selectOption('#task', process.argv[4]);
if (process.argv[5]) await page.selectOption('#speed', process.argv[5]);
console.log('t      cyc  x      y      head   angle  dist  goal    sig   trend  asym   goalL goalR  turn   fwd   spd  stuck   up falls');
const t0 = Date.now();
let switched = false;
while (Date.now() - t0 < seconds * 1000) {
  if (!switched && process.argv[6] && Date.now() - t0 > Number(process.argv[7] || 45) * 1000) { await page.selectOption('#task', process.argv[6]); switched = true; console.log('--- task switched to', process.argv[6]); }
  const d = await page.evaluate(() => window.__habitat());
  if (d && d.cycle !== undefined) {
    const f = (v, n = 2) => (typeof v === 'number' ? v.toFixed(n) : String(v)).padStart(6);
    console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}  ${String(d.cycle).padStart(4)} ${f(d.x)} ${f(d.y)} ${f(d.heading * 57.3, 0)} ${f(d.angle * 57.3, 0)} ${f(d.distance)} ${String(d.goal).padEnd(7)} ${f(d.goalSignal)} ${f(d.trend, 3)} ${f(d.asym)} ${f(d.goalL, 0)} ${f(d.goalR, 0)} ${f(d.turn)} ${f(d.forward)} ${f(d.speed)} ${d.stuck} ${f(d.up)} ${d.falls}`);
  }
  await page.waitForTimeout(2500);
}
await browser.close();
