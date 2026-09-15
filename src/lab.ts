import { loadBrain, type Brain } from './brain';
import { FlySim } from './sim';
import { FlyViewer } from './viewer';
import { Physics } from './physics';
import { Room } from './room';
import { Plasticity } from './plasticity';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const set = (id: string, text: string) => { el(id).textContent = text; };
const dialog = el<HTMLDialogElement>('model-dialog');
el('about').onclick = () => dialog.showModal();
el('close-about').onclick = () => dialog.close();
const entries: { time: number; event: string }[] = [];
let time = 0;
function log(event: string) {
  entries.push({ time, event });
  if (entries.length > 2000) entries.shift();
  const row = document.createElement('div'); row.textContent = `${time.toFixed(3)} s · ${event}`;
  el('events').prepend(row);
  while (el('events').children.length > 35) el('events').lastChild?.remove();
}
interface Meta { famous_dns: Record<string, number[]>; walking_circuit_dns?: Record<string, number[]>; super_class_table: string[] }
interface VncMeta { dn_inputs: Record<string, number[]>; motor: Record<string, Record<string, number[]>> }
const mean = (r: Float32Array, ids: number[] = []) => ids.length ? ids.reduce((a, i) => a + r[i], 0) / ids.length : 0;
const heroNames = ['', 'KC', 'MBON', 'LHN', 'PN', 'ORN', 'GF', 'DN'];

async function boot() {
  if (!navigator.gpu) throw new Error('WebGPU is required. Open this page in a current Chrome or Edge browser with hardware acceleration enabled.');
  const assetVersions = await fetch('/assets.json').then(r => { if (!r.ok) throw new Error('Asset manifest unavailable'); return r.json(); });
  const url = (env: string | undefined, file: string) => `${env || '/' + file}?v=${assetVersions[file] || '1'}`;
  const progress = (message: string) => set('boot-status', message);
  const metadata = async (path: string) => { const r = await fetch(path); if (!r.ok) throw new Error(`Missing metadata: ${path}`); return r.json(); };
  const meta: Meta = await metadata(url(import.meta.env.VITE_BRAIN_META_URL, 'brain.meta.json'));
  progress('Reading FlyWire wiring…');
  const brain = await loadBrain(url(import.meta.env.VITE_BRAIN_URL, 'brain.bin'), (n, total) => progress(`Reading brain: ${(n / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`));
  if (brain.header.numNeurons !== 139255 || brain.header.numEdges !== 15091983) throw new Error('Unexpected brain dataset; refusing substitute');
  set('neuron-count', brain.header.numNeurons.toLocaleString());
  set('edge-count', brain.header.numEdges.toLocaleString());
  const sim = await FlySim.create(brain);
  const viewer = new FlyViewer(brain, { container: el('brain-view'), pointSize: 1800 });
  progress('Reading MANC nerve-cord wiring…');
  const vncMeta: VncMeta = await metadata(url(import.meta.env.VITE_VNC_META_URL, 'vnc.meta.json'));
  const vnc = await loadBrain(url(import.meta.env.VITE_VNC_URL, 'vnc.bin'));
  const spine = await FlySim.create(vnc);
  Physics.kinematicAssistEnabled = false; Physics.attitudeDamperEnabled = false;
  const body = await Physics.create(progress);
  const room = new Room({ container: el('body-view'), bg: 0x0a1018 });
  room.externalClock = true;
  room.attachPhysics(body);
  const plasticity = new Plasticity(brain);
  let rates: Float32Array = new Float32Array(brain.header.numNeurons);
  let vncRates: Float32Array = new Float32Array(vnc.header.numNeurons);
  let input = new Float32Array(brain.header.numNeurons);
  let selected = -1, pulse = -1, pulseUntil = 0;
  let running = false, busy: Promise<void> | null = null, ready = true;
  let tickNumber = 0, stimulus = 'none', spikes = 0;
  const bridge = Object.entries({ ...meta.walking_circuit_dns, ...meta.famous_dns }).filter(([name]) => vncMeta.dn_inputs[name]?.length);
  const rows = ['DNa01', 'DNa02', 'DNp09', 'MDN', 'DNp01', 'DNg13', 'DNp20', 'DNp18'].filter(n => meta.famous_dns[n]);
  const history: number[][] = [];
  const nameOf = (i: number) => {
    const named = Object.entries(meta.famous_dns).find(([, ids]) => ids.includes(i))?.[0];
    return `${named || heroNames[brain.neurons.cellType[i] & 255] || meta.super_class_table[brain.neurons.superClass[i]] || 'Neuron'} · #${i}`;
  };
  function select(i: number) {
    selected = i; viewer.highlightNeuron(i); set('selected-name', nameOf(i));
    set('selected-detail', `${(rates[i] * 1000).toFixed(0)} Hz · source array index, not a FlyWire root ID · ${plasticity.lesions.has(i) ? 'disconnected' : 'connected'}`);
    el<HTMLButtonElement>('pulse-cell').disabled = false; el<HTMLButtonElement>('silence-cell').disabled = false;
  }
  viewer.onPick(i => select(i));
  const presets = [
    { id: 'none', label: 'No stimulus', hint: 'Q · resting circuit', ids: [] as number[], amplitude: 0 },
    { id: 'visual', label: 'Visual population', hint: 'W · optic + projection cells', ids: [] as number[], amplitude: .5 },
    { id: 'odor', label: 'Odor population', hint: 'E · olfactory receptors', ids: [] as number[], amplitude: .8 },
    { id: 'mixed', label: 'Mixed sensory', hint: 'R · sensory + optic cells', ids: [] as number[], amplitude: .4 },
    { id: 'DNp09', label: 'DNp09 drive', hint: 'A · command-neuron stimulation', ids: meta.famous_dns.DNp09 || [], amplitude: 4 },
    { id: 'MDN', label: 'MDN drive', hint: 'S · command-neuron stimulation', ids: meta.famous_dns.MDN || [], amplitude: 4 },
    { id: 'retina', label: 'Body vision', hint: 'F · rendered brightness → optic cells', ids: [] as number[], amplitude: .5 },
  ];
  for (let i = 0; i < brain.header.numNeurons; i++) {
    const sc = brain.neurons.superClass[i];
    if (sc === 9 || sc === 10) presets[1].ids.push(i);
    if (sc === 10) presets[6].ids.push(i);
    if ((brain.neurons.cellType[i] & 255) === 5) presets[2].ids.push(i);
    if (sc === 1 || sc === 10) presets[3].ids.push(i);
  }
  function choose(index: number) {
    const p = presets[index]; stimulus = p.id; input.fill(0);
    for (const i of p.ids) input[i] = p.amplitude;
    el('stimuli').querySelectorAll('button').forEach((b, j) => { b.classList.toggle('active', j === index); b.setAttribute('aria-pressed', String(j === index)); });
    log(`${p.label}: ${p.ids.length.toLocaleString()} cells, continuous input ${p.amplitude}`);
    if (p.ids.length && p.ids.length < 10) select(p.ids[0]);
  }
  presets.forEach((p, index) => {
    const b = document.createElement('button'); b.textContent = p.label;
    const small = document.createElement('small'); small.textContent = p.hint; b.append(small);
    b.onclick = () => choose(index); el('stimuli').append(b);
  });
  document.addEventListener('keydown', e => {
    if (dialog.open || (e.target as HTMLElement).matches('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const index = ['q', 'w', 'e', 'r', 'a', 's', 'f'].indexOf(e.key.toLowerCase());
    if (index >= 0) { e.preventDefault(); choose(index); }
  });
  function drawRaster() {
    const c = el<HTMLCanvasElement>('raster'); c.width = Math.max(320, c.clientWidth * devicePixelRatio); c.height = 160 * devicePixelRatio;
    const ctx = c.getContext('2d')!; ctx.scale(devicePixelRatio, devicePixelRatio);
    const width = c.width / devicePixelRatio, rowHeight = 160 / rows.length;
    ctx.fillStyle = '#0a111a'; ctx.fillRect(0, 0, width, 160); ctx.font = '11px monospace';
    rows.forEach((name, r) => { ctx.fillStyle = '#adbfce'; ctx.fillText(name, 5, r * rowHeight + 14); });
    history.forEach((column, x) => column.forEach((rate, r) => {
      ctx.fillStyle = `rgba(255,185,112,${Math.min(1, rate * 7)})`;
      ctx.fillRect(65 + x * (width - 65) / 140, r * rowHeight + 3, Math.max(1, (width - 65) / 140), rowHeight - 5);
    }));
  }
  function updateStats() {
    let active = 0; const top: number[] = [];
    for (let i = 0; i < rates.length; i++) if (rates[i] > 0) {
      active++;
      if (top.length < 8 || rates[i] > rates[top[top.length - 1]]) { top.push(i); top.sort((a, b) => rates[b] - rates[a]); top.length = Math.min(8, top.length); }
    }
    set('active-count', active.toLocaleString());
    set('spike-total', `${spikes.toLocaleString()} cumulative spikes`);
    set('neural-time', `${time.toFixed(3)} s`); set('body-time', `${body.data.time.toFixed(3)} s`);
    set('speed', `${room.bodySpeed().toFixed(2)} cm/s`);
    const list = el('top-neurons'); list.replaceChildren();
    top.forEach(i => { const b = document.createElement('button'); b.textContent = `${nameOf(i)} · ${(rates[i] * 1000).toFixed(0)} Hz`; b.onclick = () => select(i); list.append(b); });
    if (!top.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No spikes in the latest window.'; list.append(p); }
    if (selected >= 0) select(selected);
    const populations = el('population-rates'); populations.replaceChildren();
    for (const [name, ids] of [['KC', kc], ['MBON', mbon], ['Brain DN', dn], ['MANC motor', motor]] as [string, number[]][]) {
      const hz = mean(name === 'MANC motor' ? vncRates : rates, ids) * 1000;
      const row = document.createElement('div'); row.className = 'population';
      const label = document.createElement('span'); label.textContent = name;
      const track = document.createElement('div'); track.className = 'population-track';
      const fill = document.createElement('i'); fill.style.width = `${Math.min(100, hz)}%`; track.append(fill);
      const value = document.createElement('b'); value.textContent = `${hz.toFixed(1)} Hz`; row.append(label, track, value); populations.append(row);
    }
    drawRaster();
  }
  const kc: number[] = [], mbon: number[] = [], dn: number[] = [];
  for (let i = 0; i < rates.length; i++) { const hero = brain.neurons.cellType[i] & 255; if (hero === 1) kc.push(i); if (hero === 2) mbon.push(i); if (brain.neurons.superClass[i] === 5) dn.push(i); }
  const motor = [...new Set(Object.values(vncMeta.motor).flatMap(m => m.all || []))];
  const retinaCtx = el<HTMLCanvasElement>('retina').getContext('2d')!;
  room.onRetinaUpdate = () => {
    const { pixels, w, h } = room.retinaFrame();
    const image = retinaCtx.createImageData(w, h);
    for (let y = 0; y < h; y++) image.data.set(pixels.subarray((h - y - 1) * w * 4, (h - y) * w * 4), y * w * 4);
    retinaCtx.putImageData(image, 0, 0);
  };
  // Optional authored sensory bridge: image brightness to optic population input.
  // This is not a retinotopic reconstruction of ommatidia or visual synapses.
  async function quantum() {
    const start = performance.now();
    const ext = input.slice();
    if (stimulus === 'retina') {
      const frame = room.retinaFrame();
      let luminance = 0;
      for (let p = 0; p < frame.pixels.length; p += 4) luminance += (.2126 * frame.pixels[p] + .7152 * frame.pixels[p + 1] + .0722 * frame.pixels[p + 2]) / 255;
      luminance /= frame.w * frame.h;
      for (const i of presets[6].ids) ext[i] = luminance * .8;
    }
    if (pulse >= 0 && time < pulseUntil) ext[pulse] = 4;
    for (const i of plasticity.lesions) ext[i] = 0;
    sim.setExternalInput(ext);
    rates = await sim.captureRollingRate(10);
    const vncInput = new Float32Array(vnc.header.numNeurons);
    for (const [name, ids] of bridge) for (const idx of vncMeta.dn_inputs[name]) vncInput[idx] = mean(rates, ids) * 30;
    spine.setExternalInput(vncInput);
    vncRates = await spine.captureRollingRate(10);
    const pools: Record<string, { tibia: number; femur: number; coxa: number; activity: number }> = {};
    for (const [leg, groups] of Object.entries(vncMeta.motor)) {
      if (!/^T[123]_(left|right)$/.test(leg)) continue;
      const antagonist = (extNames: string[], flexNames: string[]) => {
        const e = mean(vncRates, extNames.flatMap(n => groups[n] || []));
        const f = mean(vncRates, flexNames.flatMap(n => groups[n] || []));
        return (e - f) / (e + f + 1e-8);
      };
      pools[leg] = { activity: mean(vncRates, groups.all), tibia: antagonist(['ti_extensor'], ['ti_flexor', 'acc_ti_flexor']), femur: antagonist(['tr_extensor', 'sternotrochanter'], ['tr_flexor', 'acc_tr_flexor']), coxa: antagonist(['sternal_anterior_rotator'], ['sternal_posterior_rotator']) };
    }
    if (el<HTMLSelectElement>('controller').value === 'assisted') {
      const left = ['T1_left', 'T2_left', 'T3_left'].reduce((s, k) => s + (pools[k]?.activity || 0), 0) / 3;
      const right = ['T1_right', 'T2_right', 'T3_right'].reduce((s, k) => s + (pools[k]?.activity || 0), 0) / 3;
      const direction = mean(rates, meta.famous_dns.MDN) > mean(rates, meta.famous_dns.DNp09) ? -1 : 1;
      body.driveLegs(direction * Math.min(1, (left + right) * 30), Math.max(-1, Math.min(1, (right - left) * 30)));
    } else body.driveMotorPools(pools);
    const substeps = Math.round(.01 / body.model.opt.timestep);
    if (Math.abs(substeps * body.model.opt.timestep - .01) > 1e-8) throw new Error('Physics timestep cannot be synchronized');
    room.advancePhysics(substeps);
    time = sim.currentStep / 1000;
    if (!Number.isFinite(body.data.time) || Math.abs(body.data.time - time) > 1e-6) throw new Error('Brain/body clocks diverged');
    viewer.showLive(rates);
    for (const r of rates) spikes += Math.round(r * 10);
    history.push(rows.map(name => mean(rates, meta.famous_dns[name]))); if (history.length > 140) history.shift();
    tickNumber++;
    set('rate', `${(10 / (performance.now() - start)).toFixed(2)}× real time`);
    updateStats();
  }
  function setRunning(value: boolean) { running = value; set('run', value ? 'Ⅱ Pause' : '▶ Run'); set('run-status', value ? 'Live computation' : 'Paused'); }
  function fail(error: unknown) { ready = false; setRunning(false); set('run-status', 'Simulation stopped · reload to recover'); for (const id of ['run', 'step', 'reset', 'reset-body', 'reward', 'negative', 'restore', 'restore-wiring', 'silence-cell', 'pulse-cell']) el<HTMLButtonElement>(id).disabled = true; log(`ERROR: ${String(error)}`); console.error(error); }
  function once(): Promise<void> { if (busy) return busy; busy = quantum().catch(fail).finally(() => { busy = null; }); return busy; }
  async function loop() { if (running && ready && !busy) await once(); if (ready) setTimeout(loop, running ? 0 : 100); }
  async function paused(action: () => void) { setRunning(false); if (busy) await busy; action(); }
  function applyWeights() { sim.replaceWeights(plasticity.weights()); set('modified-count', plasticity.gains.size.toLocaleString()); set('lesion-count', String(plasticity.lesions.size)); }
  sim.device.lost.then(info => fail(`Brain GPU lost: ${info.message}`)); spine.device.lost.then(info => fail(`MANC GPU lost: ${info.message}`));
  sim.device.addEventListener('uncapturederror', e => fail(e.error)); spine.device.addEventListener('uncapturederror', e => fail(e.error));
  el('run').onclick = () => { if (ready) setRunning(!running); };
  el('step').onclick = () => { if (ready) void paused(() => { void once(); }); };
  const reset = () => { sim.reset(); spine.reset(); body.reset(); time = 0; spikes = 0; tickNumber = 0; pulse = -1; rates.fill(0); vncRates.fill(0); history.length = 0; viewer.showLive(rates); updateStats(); log('Brain, MANC and body state reset; weights preserved'); };
  el('reset').onclick = () => void paused(reset);
  el('reset-body').onclick = () => void paused(reset);
  el('pulse-cell').onclick = () => { if (selected < 0) return; pulse = selected; pulseUntil = time + .2; log(`200 ms input pulse to ${nameOf(selected)}; press Run to advance`); };
  el('silence-cell').onclick = () => void paused(() => { if (selected < 0) return; plasticity.lesions.add(selected); applyWeights(); sim.reset(); spine.reset(); body.reset(); time = 0; history.length = 0; rates.fill(0); vncRates.fill(0); spikes = 0; viewer.showLive(rates); updateStats(); log(`Disconnected all incoming/outgoing edges for ${nameOf(selected)}; dynamic state reset`); });
  el<HTMLSelectElement>('controller').onchange = () => void paused(() => {
    const assisted = el<HTMLSelectElement>('controller').value === 'assisted';
    Physics.kinematicAssistEnabled = assisted; Physics.attitudeDamperEnabled = assisted;
    set('body-mode-label', assisted ? 'ASSISTED · scripted gait + velocity help' : 'MANC muscle pools → joint actuators');
    set('controller-note', assisted ? 'MANC activity scales an authored tripod gait with root-velocity assistance and attitude damping. This is a modeled controller, not biologically validated locomotion.' : 'Measured motor-neuron activity drives joint targets. No scripted gait or root velocity. Muscle gains and adhesion are modeled; coordinated walking is not guaranteed.');
    reset(); log(`Body controller: ${assisted ? 'assisted gait' : 'experimental muscle mapping'}`);
  });
  const teach = (reward: number) => void paused(() => { const count = plasticity.teach(rates, reward); if (count) applyWeights(); log(count ? `${reward > 0 ? '+' : '−'} teaching pulse: ${count.toLocaleString()} active KC → MBON edges changed` : 'No eligible co-active edges. Run a sensory stimulus before teaching.'); });
  el('reward').onclick = () => teach(1); el('negative').onclick = () => teach(-1);
  el('save').onclick = () => { try { localStorage.setItem('connectome-house-checkpoint', JSON.stringify(plasticity.checkpoint())); log('Synaptic checkpoint saved in this browser'); } catch (e) { log(`Save failed: ${e}`); } };
  el('restore').onclick = () => void paused(() => { try { const raw = localStorage.getItem('connectome-house-checkpoint'); if (!raw) throw new Error('No checkpoint saved'); plasticity.restore(JSON.parse(raw)); applyWeights(); reset(); log('Synaptic checkpoint restored'); } catch (e) { log(`Restore failed: ${e}`); } });
  el('restore-wiring').onclick = () => void paused(() => { plasticity.reset(); applyWeights(); reset(); log('Original measured weights and wiring restored'); });
  el('export').onclick = () => {
    const report = { model: 'Connectome House / experimental LIF + cross-specimen DN bridge + MuJoCo', source: 'https://github.com/abgnydn/webgpu-fly', time, stimulus, controller: el<HTMLSelectElement>('controller').value, parameters: sim.params, checkpoint: plasticity.checkpoint(), neuralRatesHz: Array.from(rates, n => n * 1000), events: entries };
    const href = URL.createObjectURL(new Blob([JSON.stringify(report)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = href; a.download = `connectome-experiment-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(href), 2000); log('Experiment log exported');
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) setRunning(false); });
  for (const id of ['run', 'step', 'reset', 'reset-body', 'reward', 'negative', 'save', 'restore', 'restore-wiring', 'export']) el<HTMLButtonElement>(id).disabled = false;
  set('reset-body', 'Reset pose & state');
  choose(0); updateStats(); setRunning(false); el('boot').remove();
  log(`${bridge.length} DN cell-type names bridge FlyWire to MANC; ${plasticity.eligible.length.toLocaleString()} measured KC → MBON edges eligible`);
  log('Prepared data has 62,248 zero-weight KC → MBON edges and 13 inhibitory ones. Teaching preserves these signs; biological learning is not established.');
  log(`Ready: ${body.model.nbody} body segments, ${body.model.nu} actuators. Select an input, then Run.`);
  void loop();
}
boot().catch(error => { set('boot-status', `Unable to start: ${error instanceof Error ? error.message : error}`); el<HTMLProgressElement>('boot-progress').hidden = true; console.error(error); });
