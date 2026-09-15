import { chromium } from '@playwright/test';
const url = process.argv[2] || 'http://127.0.0.1:4173/world.html';
const runFor = Number(process.argv[3] || 25000);
const shot = process.argv[4] || 'probe.png';
const browser = await chromium.launch({ headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--disable-dawn-features=disallow_unsafe_apis', '--window-size=1600,1000'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = [];
page.on('console', m => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning' || t.includes('[habitat]') || t.includes('[sim]')) logs.push(`${m.type()}: ${t.slice(0, 300)}`); });
page.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
page.on('response', r => { if (r.status() >= 400) logs.push(`HTTP ${r.status()} ${r.url()}`); });
const t0 = Date.now();
page.on('load', async () => { try { const info = await page.evaluate(async () => { const a = await navigator.gpu?.requestAdapter(); const i = a?.info; return i ? `${i.vendor} ${i.architecture} ${i.device} ${i.description}` : 'no adapter'; }); console.log('GPU', info); } catch (e) { console.log('GPU query failed', e.message); } });
await page.goto(url);
try { await page.waitForSelector('#loading[hidden]', { state: 'attached', timeout: 240000 }); } catch { logs.push('TIMEOUT waiting for boot'); }
console.log('boot ms', Date.now() - t0);
await page.waitForTimeout(runFor);
const read = async id => (await page.locator('#' + id).textContent().catch(() => 'n/a'))?.trim();
for (const id of ['status', 'brain-window', 'clock-neural', 'clock-physics', 'clock-habitat', 'clock-cycle', 'activity', 'position', 'behavior', 'target', 'reward', 'update-count', 'steer-updates', 'steer-adv', 'save-state', 'selected-name', 'boot']) console.log(id.padEnd(13), await read(id));
if (process.argv[5] === 'endlife') { await page.click('#next'); await page.waitForTimeout(9000); console.log('after end-life: generation', (await page.locator('#generation').textContent())?.trim(), '| badge', (await page.locator('#life-badge').textContent())?.trim(), '| lineage rows', await page.locator('#lineage .life-row').count(), '| comparison:', (await page.locator('#comparison').textContent())?.trim().slice(0, 160)); }
await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
await page.screenshot({ path: shot });
try {
  console.log('debug', JSON.stringify(await page.evaluate(() => { const d = window.__habitat(); return { falls: d.falls, cycle: d.cycle }; })));
  const saved = await page.evaluate(() => localStorage.getItem('fly-habitat-lineage-v1'));
  const c = JSON.parse(saved).life;
  console.log('--- lineage state', JSON.stringify({ generation: c.state.generation, age: c.state.age, alive: c.state.alive, fuel: c.state.fuel, water: c.state.water, rest: c.state.rest, health: c.state.health, meals: c.state.meals, drinks: c.state.drinks, sleeps: c.state.sleeps, tasks: c.state.tasks, eggs: c.state.eggsLaid, reward: c.state.reward, travelled: c.state.travelled, action: c.state.action }));
  console.log('steer weights', c.steer.weights.map(w => w.toFixed(2)).join(' '), 'updates', c.steer.updates);
  console.log('lifetimes', JSON.stringify(c.lifetimes.map(l => ({ g: l.generation, cause: l.cause, age: Math.round(l.age), tasks: l.tasks, meals: l.meals, drinks: l.drinks, reward: +l.reward.toFixed(1), travelled: +l.travelled.toFixed(2) }))));
  console.log('--- journal (last 20)');
  for (const m of c.memories.slice(-20)) console.log(`G${m.generation} ${m.age.toFixed(0)}s  ${m.event}`);
} catch (e) { console.log('lineage dump failed', e.message); }
console.log('--- console');
for (const l of logs.slice(-40)) console.log(l);
await browser.close();
