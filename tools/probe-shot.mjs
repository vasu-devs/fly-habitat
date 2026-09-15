import { chromium } from '@playwright/test';
const [url, out, w = '1600', h = '1000'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-unsafe-webgpu', '--window-size=' + w + ',' + h] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto(url); await page.waitForTimeout(3500);
console.log('gpu line:', (await page.locator('#gpu').textContent().catch(() => 'n/a'))?.trim());
await page.screenshot({ path: out }); await browser.close();
