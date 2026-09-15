// landing.ts — the entry page. Nothing heavy loads here: a WebGPU capability
// check with the adapter's name. The actual simulation loads on world.html.


const gpu = document.getElementById('gpu')!;
(async () => {
  if (!('gpu' in navigator)) { gpu.textContent = 'WebGPU not available in this browser'; gpu.className = 'gpu bad'; return; }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no adapter');
    const info = adapter.info;
    const name = [info?.vendor, info?.architecture, info?.device, info?.description].filter(Boolean).join(' ').trim();
    gpu.textContent = `WebGPU ready${name ? ` · ${name}` : ''}`; gpu.className = 'gpu ok';
  } catch { gpu.textContent = 'WebGPU adapter unavailable · enable hardware acceleration'; gpu.className = 'gpu bad'; }
})();
