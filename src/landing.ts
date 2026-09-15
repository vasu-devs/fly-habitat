// landing.ts — the entry page. Nothing heavy loads here: a WebGPU capability
// check with the adapter's name, and a light ambient point field (not neuron
// data; the real brain is one click away on world.html).

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

// Ambient field: slow drifting points with occasional "spikes" of brightness.
const canvas = document.getElementById('field') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (ctx && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let w = 0, h = 0, dpr = 1;
  const N = 900;
  const pts = new Float32Array(N * 4); // x, y, phase, speed
  const seed = (i: number) => { pts[4 * i] = Math.random(); pts[4 * i + 1] = Math.random(); pts[4 * i + 2] = Math.random() * 6.28; pts[4 * i + 3] = .4 + Math.random(); };
  for (let i = 0; i < N; i++) seed(i);
  const resize = () => { dpr = Math.min(devicePixelRatio, 2); w = innerWidth; h = innerHeight; canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  resize(); addEventListener('resize', resize);
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    ctx.fillStyle = '#0b0e11'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < N; i++) {
      const o = 4 * i;
      pts[o] += Math.sin(pts[o + 2]) * pts[o + 3] * dt * .004; pts[o + 1] += Math.cos(pts[o + 2] * .7) * pts[o + 3] * dt * .003; pts[o + 2] += dt * .3;
      if (pts[o] < 0 || pts[o] > 1 || pts[o + 1] < 0 || pts[o + 1] > 1) seed(i);
      const flash = Math.max(0, Math.sin(pts[o + 2] * 3.1 + i) - .96) * 25; // brief spike-like flashes
      const x = pts[o] * w, y = pts[o + 1] * h;
      // Cluster the field toward the right so the headline stays readable.
      const weight = .25 + .75 * pts[o];
      ctx.fillStyle = flash > 0 ? `rgba(240,180,74,${Math.min(1, .25 + flash) * weight})` : `rgba(133,147,160,${.14 * weight})`;
      ctx.fillRect(x, y, flash > 0 ? 2 : 1, flash > 0 ? 2 : 1);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
