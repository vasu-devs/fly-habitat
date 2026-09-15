import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4173/bench.html');
console.log(await page.evaluate(async () => {
  const out = [];
  for (const pref of ['high-performance', 'low-power', undefined]) {
    const a = await navigator.gpu.requestAdapter(pref ? { powerPreference: pref } : undefined);
    out.push(`${pref}: ${a?.info?.vendor} ${a?.info?.architecture} ${a?.info?.device} ${a?.info?.description}`);
  }
  return out.join('\n');
}));
await browser.close();
