// world.ts — Fly Habitat: measured FlyWire brain → learned behaviour → anatomical body.
//
// One control cycle:
//   senses.smell/see  → encode ext_input (bilateral ORN channels, optic lobes)
//   FlySim (WebGPU)   → per-neuron rates over a WINDOW of 1 ms LIF steps
//   senses.lateral…   → left−right asymmetries → Steering.act → turn
//   Life.choose       → goal from interoception + population rates + sensed odor
//   Physics/Room      → tripod gait toward turn/forward; MuJoCo contacts; retina render
//   reward            → Steering.learn (progress), Life.step (homeostasis, tasks, death)
import { loadBrain } from './brain';
import { FlySim } from './sim';
import { BodyClient as Physics } from './bodyClient';
import { withDeadline } from './deadline';
import { Room } from './room';
import { Habitat } from './habitat';
import { FlyViewer } from './viewer';
import { Plasticity } from './plasticity';
import { Life, PLACES, ACTIONS, READOUT_POPULATIONS, type Action } from './life';
import { buildPopulations, smell, see, encode, populationRates, lateralFeatures, mean, isLeftOf, STEER_FEATURE_NAMES, POPULATIONS, LATERAL, ODOR_CHANNELS, type Populations, type OdorSource, type Smell } from './senses';
import { loadManifest } from './manifest';
import releaseAssets from '../release-assets.json';
import { habitatFixturesXml } from './habitatFixtures';
import { buildPixelOrder, classify, connectivity, drive, paintNeuronMatrix, MATRIX_LABELS, K, type PixelLayout, type Connectivity } from './matrix';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => { const node = el(id); if (node.textContent !== value) node.textContent = value; };
const button = (id: string) => el<HTMLButtonElement>(id);
const input = (id: string) => el<HTMLInputElement>(id);
const select = (id: string) => el<HTMLSelectElement>(id);
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const dialog = el<HTMLDialogElement>('model');
button('about').onclick = () => dialog.showModal(); button('close-about').onclick = () => dialog.close();
button('reload').onclick = () => location.reload();

const SAVE = 'fly-habitat-lineage-v1';
const benchmark = new URLSearchParams(location.search).has('benchmark');
const timingSamples: { cycle: number; brain: number; body: number }[] = [];
let readyAt = Infinity, startupLongestTaskMs = 0, runLongestTaskMs = 0;
if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if (entry.startTime < readyAt) startupLongestTaskMs = Math.max(startupLongestTaskMs, entry.duration);
      else runLongestTaskMs = Math.max(runLongestTaskMs, entry.duration);
    }
  }).observe({ type: 'longtask', buffered: true });
}
const visiblePanels = new Set<Element>();
const panelObserver = new IntersectionObserver(entries => {
  for (const entry of entries) { if (entry.isIntersecting) visiblePanels.add(entry.target); else visiblePanels.delete(entry.target); }
  if (ready) refreshInstruments();
});
for (const panel of document.querySelectorAll('.panel')) panelObserver.observe(panel);
const panelVisible = (id: string) => visiblePanels.has(el(id).closest('.panel')!);
let lastInstruments = 0;
const ODOR_DECAY = .6;            // per cm; a plume at 1 cm is 55 % of its source strength, 22 % at 2.5 cm
const HABITAT_DT = .08;           // habitat seconds per pace unit per cycle (16 ms of physics): 240-s lifespan ≈ 48 s of body time
const STUCK_WINDOW = 20;          // cycles of no displacement that trigger the escape reflex
const DECISION_INTERVAL = 48;     // habitat seconds a goal is kept without arriving (~200 cycles at pace 3, ≈ one crossing of the house)
const CRITICAL = 15;              // a need below this forces an immediate re-decision
const life = new Life();
const descriptions: Record<Action, string> = { eat: 'Following the fruit plume; eating restores energy.', drink: 'Following the water plume to restore hydration.', sleep: 'Heading for the dark refuge to rest.', forage: 'Collecting pollen for a nursery delivery.', nest: 'Delivering pollen and preparing an egg.', explore: 'Wandering the courtyard.' };
const doing: Record<Action, string> = { eat: 'Eating fruit', drink: 'Drinking', sleep: 'Sleeping', forage: 'Collecting pollen', nest: 'Tending nursery', explore: 'Exploring' };
const vitalNames = ['Energy', 'Hydration', 'Rest', 'Health'] as const;
const vitalFields = ['fuel', 'water', 'rest', 'health'] as const;
for (let i = 0; i < vitalFields.length; i++) {
  const row = document.createElement('div'); row.className = 'vital'; row.id = `vital-${vitalFields[i]}`;
  row.innerHTML = `<div><span>${vitalNames[i]}</span><b id="value-${vitalFields[i]}">—</b></div><progress id="bar-${vitalFields[i]}" max="100" value="100" aria-label="${vitalNames[i]}"></progress>`;
  el('vitals').append(row);
}

interface Meta { famous_dns: Record<string, number[]>; famous_dn_descriptions: Record<string, string>; super_class_table: string[] }
const heroNames = ['', 'Kenyon cell', 'MBON', 'Lateral horn neuron', 'Projection neuron', 'Olfactory receptor neuron', 'Giant fiber', 'Descending neuron'];
const STRIP_DNS = ['DNa01', 'DNa02', 'DNb01', 'DNp01', 'DNp09', 'DNg13', 'MDN', 'DNp52'];
const STRIP_COLS = 240;

let running = false, ready = false, busy = false, fatal = false, requestedDeath = false;
let room: Room, body: Physics, habitat: Habitat, sim: FlySim, viewer: FlyViewer, pops: Populations, plasticity: Plasticity, meta: Meta;
let rates: Float32Array, ext: Float32Array;
let pendingWiring = false;
let pose: number[] | undefined;
let smelled: Smell;
let popHz: Record<string, number> = {};
let lateral: number[] = [];
let lastDecision = -100, arrivedFor = 0, prevDistance = NaN, lastSave = 0;
const trail: [number, number][] = [];
let stuckTurn = 1;
/** Escape reflex state: back away from the obstacle, quarter-turn, then a short straight run. */
let escape: { phase: 'back' | 'turn' | 'straight'; left: number } | null = null;
let prevGoalSignal = NaN, goalTrend = 0, prevGoal: Action | null = null;
let fallen = 0, falls = 0;
let layout: PixelLayout, conn: Connectivity, matrixImage: ImageData, driveBuf: Float64Array;
let connMode: 'wiring' | 'drive' = 'wiring';
let vision = { left: 0, right: 0 };
/** Per-cycle snapshot for probes and debugging (window.__habitat()). */
let debug: Record<string, unknown> = {};
(window as unknown as { __habitat: () => Record<string, unknown> }).__habitat = () => debug;
let lastMemoryCount = -1, lastMemoryEvent: object | undefined, lastLifetimeCount = -1;
let selected = -1, pulseUntil = -1, pulseNeuron = -1;
let active = 0, cycles = 0, neuralMs = 0, physicsSeconds = 0, cycleMs = 0, brainMs = 0, bodyMs = 0;
const strip: number[][] = [];
let stripRows: { name: string; ids: number[]; pop: boolean }[] = [];

const bootStarted = performance.now();
let progressAt = bootStarted;
function progress(message: string) { progressAt = performance.now(); text('boot', message); text('status', 'Loading model'); console.info('[habitat]', message); }
const bootWatch = setInterval(() => {
  if (ready || fatal) { clearInterval(bootWatch); return; }
  const elapsed = Math.round((performance.now() - bootStarted) / 1000);
  text('load-detail', `${elapsed} s elapsed · The full model loads once and is cached for later visits.`);
  text('runtime-detail', 'Preparing measured anatomy and brain wiring. You can explore the controls while it loads.');
  if (performance.now() - progressAt > 45_000) {
    text('load-detail', `${elapsed} s elapsed · Still waiting for the model. You can reload without clearing the saved lineage.`);
    button('reload').hidden = false;
  }
}, 1000);
// The headline count eases toward the new value so it reads as a signal, not a jitter.
let shownActive = 0, activityTarget = 0, tweening = false;
function tweenActivity(target: number) {
  activityTarget = target; if (tweening) return; tweening = true;
  const step = () => { shownActive += (activityTarget - shownActive) * .25; if (Math.abs(activityTarget - shownActive) < 1) { shownActive = activityTarget; tweening = false; } text('activity', Math.round(shownActive).toLocaleString()); if (tweening) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function bootBar(fraction: number) { el('boot-bar').style.width = `${Math.round(clamp(fraction, 0, 1) * 100)}%`; }
function save() {
  if (benchmark) return;
  try {
    localStorage.setItem(SAVE, JSON.stringify({ life: life.checkpoint(), pose: body ? Array.from(body.data.qpos as Float64Array) : undefined }));
    text('save-state', `Saved locally · ${life.updates + life.steering.updates} updates`);
  } catch { text('save-state', 'Storage unavailable — export to keep this lineage'); }
}
function setRunning(value: boolean) {
  running = value && !fatal && ready;
  button('play').textContent = running ? 'Pause life' : 'Resume life';
  text('status', running ? 'Live experiment' : fatal ? 'Experiment stopped' : 'Paused');
  el('live-dot').classList.toggle('running', running);
  text('runtime-detail', running ? 'Brain, body and learning are active. This lineage is saved on your device.' : fatal ? 'Simulation stopped. Return to Observe to reload the saved session.' : 'Paused. Camera, neural inspection and experiment controls remain available.');
}
function stop(error: unknown) {
  if (fatal) return;
  fatal = true; setRunning(false);
  const message = error instanceof Error ? error.message : String(error);
  text('boot', message); el('loading').hidden = false; el('boot').classList.add('error');
  el('loading').querySelector('strong')!.textContent = 'The simulation could not continue';
  button('reload').hidden = false; button('play').disabled = true;
  text('status', 'Stopped · see Observe');
  for (const id of ['next', 'reward-plus', 'reward-minus', 'pulse-cell', 'silence-cell', 'restore-wiring']) button(id).disabled = true;
  select('task').disabled = true; input('gain').disabled = true; input('import').disabled = true;
  el('loading').querySelector('.loader')?.remove();
  // Never overwrite a good saved lineage with a fresh default after a boot failure.
  if (ready) save();
  body?.dispose(); sim?.device.destroy(); console.error(error);
}
function setCamera(mode: 'overview' | 'follow' | 'macro') {
  room.setView(mode); for (const id of ['overview', 'follow', 'macro']) button(id).classList.toggle('active', mode === id);
  habitat.setAnnotations(mode === 'overview');
  el('viewport').querySelector<HTMLElement>('.scene-heading')!.style.display = mode === 'macro' ? 'none' : '';
}
function nameOf(i: number) {
  const named = Object.entries(meta.famous_dns).find(([, ids]) => ids.includes(i))?.[0];
  const hero = heroNames[sim.brain.neurons.cellType[i] & 255];
  return `${named ? `${named} (${meta.famous_dn_descriptions[named] || 'descending neuron'})` : hero || meta.super_class_table[sim.brain.neurons.superClass[i]] || 'Neuron'} · #${i}`;
}
function selectNeuron(i: number) {
  selected = i; viewer.highlightNeuron(i);
  text('selected-name', nameOf(i));
  const inDeg = sim.brain.rowPtr[i + 1] - sim.brain.rowPtr[i];
  const side = isLeftOf(sim.brain.neurons.pos[3 * i], pops.medianX) ? 'left' : 'right';
  text('selected-detail', `${(rates[i] * 1000).toFixed(0)} Hz in the last window · ${inDeg.toLocaleString()} incoming synaptic partners · ${side} hemisphere · ${life.lesions.includes(i) ? 'disconnected' : 'connected'} · index in the prepared graph, not a FlyWire root ID`);
  button('pulse-cell').disabled = false; button('silence-cell').disabled = life.lesions.includes(i);
}
/** Push measured weights (lesions + strength) to the GPU. */
function applyWiring() {
  plasticity.lesions.clear(); for (const i of life.lesions) plasticity.lesions.add(i);
  const weights = plasticity.weights();
  if (life.synapseGain !== 1) for (let e = 0; e < weights.length; e++) weights[e] *= life.synapseGain;
  sim.replaceWeights(weights);
}

// ---------- UI: static builders ----------
function buildPopulationRows() {
  const host = el('populations'); host.replaceChildren();
  for (const p of POPULATIONS) {
    const row = document.createElement('div'); row.className = 'population'; row.id = `pop-${p}`;
    const isLateral = (LATERAL as readonly string[]).includes(p);
    const count = pops.all[p].length.toLocaleString();
    row.innerHTML = isLateral
      ? `<span class="name">${p}<small>${count} cells</small></span><div class="track left"><i></i></div><div class="track right"><i></i></div><b>0</b>`
      : `<span class="name">${p}<small>${count} cells</small></span><div class="track single"><i style="left:0"></i></div><b>0</b>`;
    host.append(row);
  }
}
function buildBars(id: string, names: string[]) {
  const host = el(id); host.replaceChildren();
  names.forEach((n, i) => { const row = document.createElement('div'); row.className = 'bar'; row.id = `${id}-${i}`; row.innerHTML = `<span>${n}</span><div class="track"><i></i></div><b>0</b>`; host.append(row); });
}
function setBar(id: string, i: number, value: number, scale: number, activeRow = false) {
  const row = el(`${id}-${i}`); const bar = row.querySelector('i')!; const w = clamp(Math.abs(value) / scale, 0, 1) * 50;
  bar.style.width = `${w}%`; bar.classList.toggle('neg', value < 0); row.querySelector('b')!.textContent = value.toFixed(2); row.classList.toggle('active', activeRow);
}
function buildStrip() {
  stripRows = [...STRIP_DNS.filter(n => meta.famous_dns[n]).map(n => ({ name: n, ids: meta.famous_dns[n], pop: false })),
    { name: 'ORN L', ids: pops.left.ORN, pop: true }, { name: 'ORN R', ids: pops.right.ORN, pop: true }, { name: 'PN', ids: pops.all.PN, pop: true }, { name: 'KC', ids: pops.all.KC, pop: true }, { name: 'MBON', ids: pops.all.MBON, pop: true }, { name: 'DN', ids: pops.all.DN, pop: true }];
  const labels = el('strip-labels'); labels.replaceChildren();
  labels.style.gridTemplateRows = `repeat(${stripRows.length},1fr)`;
  for (const r of stripRows) { const s = document.createElement('span'); s.textContent = r.name; if (r.pop) s.className = 'pop'; labels.append(s); }
}
function drawStrip() {
  const c = el<HTMLCanvasElement>('strip'); const w = c.clientWidth || 800; if (c.width !== w * devicePixelRatio) c.width = w * devicePixelRatio;
  const h = 178; c.height = h * devicePixelRatio;
  const ctx = c.getContext('2d')!; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.fillStyle = '#0d1115'; ctx.fillRect(0, 0, w, h);
  const rowH = h / stripRows.length, colW = w / STRIP_COLS;
  ctx.strokeStyle = '#1a222a'; ctx.beginPath(); for (let r = 1; r < stripRows.length; r++) { ctx.moveTo(0, r * rowH); ctx.lineTo(w, r * rowH); } ctx.stroke();
  strip.forEach((col, x) => col.forEach((v, r) => {
    if (v <= 0) return;
    const a = clamp(Math.sqrt(v * (stripRows[r].pop ? 40 : 12)), .08, 1);
    ctx.fillStyle = stripRows[r].pop ? `rgba(201,138,42,${a})` : `rgba(240,180,74,${a})`;
    ctx.fillRect(x * colW, r * rowH + 2, Math.max(1, colW - .5), rowH - 4);
  }));
  const x = strip.length * colW; ctx.fillStyle = '#f0b44a'; ctx.fillRect(x, 0, 1, h);
}
function drawLineage() {
  const c = el<HTMLCanvasElement>('lineage-chart'); const w = c.clientWidth || 300; c.width = w * devicePixelRatio; c.height = 90 * devicePixelRatio;
  const ctx = c.getContext('2d')!; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); ctx.clearRect(0, 0, w, 90);
  const rows = life.lifetimes.slice(-40); if (!rows.length) { ctx.fillStyle = '#5d6b78'; ctx.font = '10px IBM Plex Mono, monospace'; ctx.fillText('reward per lifetime · deliveries', 0, 50); return; }
  const maxR = Math.max(1, ...rows.map(r => Math.abs(r.reward))), maxT = Math.max(1, ...rows.map(r => r.tasks));
  const bw = w / rows.length;
  rows.forEach((r, i) => { const hgt = Math.abs(r.reward) / maxR * 36; ctx.fillStyle = r.reward >= 0 ? '#c98a2a' : '#e0705a'; ctx.fillRect(i * bw + 1, r.reward >= 0 ? 44 - hgt : 44, Math.max(1, bw - 2), Math.max(1, hgt)); });
  ctx.strokeStyle = '#8fd19b'; ctx.lineWidth = 1.4; ctx.beginPath();
  rows.forEach((r, i) => { const x = i * bw + bw / 2, y = 88 - r.tasks / maxT * 40; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  ctx.fillStyle = '#5d6b78'; ctx.font = '9px IBM Plex Mono, monospace'; ctx.fillText('reward', 0, 8); ctx.fillStyle = '#8fd19b'; ctx.fillText('deliveries', 0, 60);
}

// ---------- matrices: every neuron, connectome, senses ----------
const CONN_CELL = 30;
function buildMatrixUi() {
  const groups = el('matrix-groups'); groups.replaceChildren();
  for (const g of layout.groups) {
    const s = document.createElement('span'); const share = g.count / layout.order.length;
    s.style.flex = `${Math.max(share, .004)} 1 0`; s.textContent = share > .045 ? `${g.name} ${g.count.toLocaleString()}` : share > .012 ? g.name : ''; if (share <= .012) s.className = 'tiny'; s.title = `${g.name}: ${g.count.toLocaleString()} cells (${g.left.toLocaleString()} left)`;
    groups.append(s);
  }
  text('matrix-count', `${layout.order.length.toLocaleString()} px`);
  const canvas = el<HTMLCanvasElement>('neuron-matrix'); canvas.width = layout.width; canvas.height = layout.height;
  const ay = el('conn-axis-y'), ax = el('conn-axis-x'); ay.replaceChildren(); ax.replaceChildren();
  ay.style.gridTemplateRows = `repeat(${K},1fr)`;
  for (const name of MATRIX_LABELS) { const a = document.createElement('span'); a.textContent = name; ay.append(a); const b = document.createElement('span'); b.textContent = name; ax.append(b); }
  const cm = el<HTMLCanvasElement>('conn-matrix'); cm.width = K * CONN_CELL; cm.height = K * CONN_CELL;
  cm.onmousemove = e => {
    const r = cm.getBoundingClientRect(); const pre = Math.floor((e.clientY - r.top) / r.height * K), post = Math.floor((e.clientX - r.left) / r.width * K);
    if (pre < 0 || post < 0 || pre >= K || post >= K) return;
    const i = pre * K + post; const w = conn.weight[i], n = conn.count[i];
    text('conn-readout', `${MATRIX_LABELS[pre]} → ${MATRIX_LABELS[post]}: ${n.toLocaleString()} edges · summed weight ${w >= 0 ? '+' : ''}${Math.round(w).toLocaleString()} (excitatory ${Math.round(conn.excit[i]).toLocaleString()}, inhibitory ${Math.round(conn.inhib[i]).toLocaleString()})${connMode === 'drive' ? ` · live drive ${driveBuf[i].toFixed(1)} weight·spikes/ms` : ''}`);
  };
  cm.onmouseleave = () => text('conn-readout', 'Rows are presynaptic, columns postsynaptic. Hover a cell for the summed signed weight and edge count.');
  button('conn-wiring').onclick = () => { connMode = 'wiring'; button('conn-wiring').classList.add('active'); button('conn-drive').classList.remove('active'); text('conn-mode-label', 'measured wiring'); drawConn(); };
  button('conn-drive').onclick = () => { connMode = 'drive'; button('conn-drive').classList.add('active'); button('conn-wiring').classList.remove('active'); text('conn-mode-label', 'presynaptic rate × weight (estimate)'); drawConn(); };
  const sniff = el('sniff'); sniff.replaceChildren();
  const names = PLACES.filter(p => p.channel >= 0).map(p => p.name.split(' ')[0]);
  for (let c = 0; c < ODOR_CHANNELS; c++) { const row = document.createElement('div'); row.className = 'sniff'; row.id = `sniff-${c}`; row.innerHTML = `<span>${names[c] ?? `channel ${c}`}</span><div class="track left"><i></i></div><div class="track right"><i></i></div>`; sniff.append(row); }
  // Brain view controls
  const filter = select('filter');
  for (const p of POPULATIONS) { const o = document.createElement('option'); o.value = p; o.textContent = `${p} · ${pops.all[p].length.toLocaleString()}`; filter.append(o); }
  filter.onchange = () => viewer.setFilter(filter.value ? pops.all[filter.value as typeof POPULATIONS[number]] : null);
  button('orbit').onclick = () => { const on = button('orbit').dataset.on !== 'true'; button('orbit').dataset.on = String(on); viewer.setAutoOrbit(on); };
  button('hemi').onclick = () => { const on = button('hemi').dataset.on !== 'true'; button('hemi').dataset.on = String(on); viewer.setHemisphereTint(on); };
  for (const b of el('brain-pane').querySelectorAll<HTMLButtonElement>('[data-preset]')) b.onclick = () => { viewer.setPreset(b.dataset.preset as 'front' | 'top' | 'side' | 'iso'); for (const o of el('brain-pane').querySelectorAll('[data-preset]')) o.classList.toggle('active', o === b); };
}
function drawConn() {
  const cm = el<HTMLCanvasElement>('conn-matrix'); const ctx = cm.getContext('2d')!;
  const values = connMode === 'wiring' ? conn.weight : drive(rates, pops, conn, driveBuf);
  let max = 1e-9; for (let i = 0; i < values.length; i++) max = Math.max(max, Math.abs(values[i]));
  const scale = (v: number) => Math.sign(v) * Math.log1p(Math.abs(v)) / Math.log1p(max);
  ctx.fillStyle = '#0b0e11'; ctx.fillRect(0, 0, cm.width, cm.height);
  for (let pre = 0; pre < K; pre++) for (let post = 0; post < K; post++) {
    const v = scale(values[pre * K + post]); if (v === 0) continue;
    const a = Math.min(1, Math.abs(v)) ** .7;
    ctx.fillStyle = v > 0 ? `rgba(240,180,74,${a})` : `rgba(79,179,201,${a})`;
    ctx.fillRect(post * CONN_CELL + 1, pre * CONN_CELL + 1, CONN_CELL - 2, CONN_CELL - 2);
  }
}
function drawEye() {
  const { pixels, w, h } = room.retinaFrame(); const eye = el<HTMLCanvasElement>('eye'); const ctx = eye.getContext('2d')!;
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) image.data.set(pixels.subarray((h - y - 1) * w * 4, (h - y) * w * 4), y * w * 4);
  ctx.putImageData(image, 0, 0);
  text('eye-left', vision.left.toFixed(2)); text('eye-right', vision.right.toFixed(2));
  if (smelled) for (let c = 0; c < ODOR_CHANNELS; c++) { const row = el(`sniff-${c}`); (row.querySelector('.left i') as HTMLElement).style.width = `${clamp(smelled.left[c], 0, 1) * 100}%`; (row.querySelector('.right i') as HTMLElement).style.width = `${clamp(smelled.right[c], 0, 1) * 100}%`; }
}

function refreshInstruments() {
  if (panelVisible('neuron-matrix')) { paintNeuronMatrix(matrixImage.data, rates, layout); el<HTMLCanvasElement>('neuron-matrix').getContext('2d')!.putImageData(matrixImage, 0, 0); }
  if (panelVisible('conn-matrix')) drawConn();
  if (panelVisible('eye')) drawEye();
  if (panelVisible('strip')) drawStrip();
}

// ---------- UI: per-cycle render ----------
function render() {
  const s = life.state;
  text('generation', String(s.generation).padStart(3, '0')); text('age', `${s.age.toFixed(1)} s`);
  const badge = el('life-badge'); badge.textContent = s.alive ? 'alive' : 'deceased'; badge.classList.toggle('dead', !s.alive);
  text('action-description', s.alive ? descriptions[s.action] : 'Lifetime archived. A descendant inherits both learners and the journal.');
  text('behavior', s.alive ? (arrivedFor > .1 ? doing[s.action] : `Seeking ${PLACES.find(p => p.id === s.action)!.name.toLowerCase()}`) : 'Lifetime complete');
  text('target', `Generation ${s.generation} · ${s.tasks} deliveries · ${s.pollen ? 'carrying pollen' : `${s.eggsLaid} eggs laid`} · ${(s.travelled * 10).toFixed(0)} mm walked`);
  for (const field of vitalFields) { text(`value-${field}`, `${Math.round(s[field])}%`); (el(`bar-${field}`) as HTMLProgressElement).value = s[field]; el(`vital-${field}`).dataset.low = String(s[field] < 25); }
  tweenActivity(active);
  text('clock-neural', (neuralMs / 1000).toFixed(3)); text('clock-physics', physicsSeconds.toFixed(2)); text('clock-habitat', life.totalSeconds.toFixed(0)); text('clock-cycle', cycleMs.toFixed(0));
  text('brain-window', `${select('window').value} ms window · brain ${brainMs.toFixed(0)} ms · body ${bodyMs.toFixed(0)} ms · ${cycles} cycles`);
  text('update-count', `${life.updates} goal updates`); text('reward', `${life.lastReward >= 0 ? '+' : ''}${life.lastReward.toFixed(3)}`);
  text('steer-updates', `${life.steering.updates} updates · σ ${life.steering.sigma.toFixed(2)}`); text('steer-adv', `${life.steering.lastAdvantage >= 0 ? '+' : ''}${life.steering.lastAdvantage.toFixed(3)}`);
  ACTIONS.forEach((a, i) => setBar('q-values', i, life.lastScores[i] ?? 0, 4, a === s.action));
  life.steering.weights.forEach((w, i) => setBar('steer-weights', i, w, 4, Math.abs(lateral[i] ?? 0) > .05));
  text('egg-count', `${life.eggs.length} eggs`); text('memory-count', `${life.memories.length} memories`);
  for (const p of POPULATIONS) {
    const row = el(`pop-${p}`); const hz = (popHz[p] ?? 0) * 1000;
    if ((LATERAL as readonly string[]).includes(p)) {
      const l = mean(rates, pops.left[p as typeof LATERAL[number]]) * 1000, r = mean(rates, pops.right[p as typeof LATERAL[number]]) * 1000;
      (row.querySelector('.left i') as HTMLElement).style.width = `${clamp(l / 80, 0, 1) * 100}%`;
      (row.querySelector('.right i') as HTMLElement).style.width = `${clamp(r / 80, 0, 1) * 100}%`;
    } else (row.querySelector('.single i') as HTMLElement).style.width = `${clamp(hz / 80, 0, 1) * 100}%`;
    row.querySelector('b')!.textContent = hz.toFixed(hz < 10 ? 1 : 0);
  }
  if (lastMemoryCount !== life.memories.length || lastMemoryEvent !== life.memories.at(-1)) {
    const journal = el('journal'); journal.replaceChildren();
    for (const memory of life.memories.slice(-24).reverse()) {
      const row = document.createElement('div'); row.className = 'memory';
      const time = document.createElement('time'); time.textContent = `G${memory.generation} · ${memory.age.toFixed(0)}s`;
      const content = document.createElement('span'); content.textContent = memory.event; row.append(time, content); journal.append(row);
    }
    lastMemoryCount = life.memories.length; lastMemoryEvent = life.memories.at(-1);
  }
  if (lastLifetimeCount !== life.lifetimes.length) {
    const panel = el('lineage'); panel.replaceChildren();
    for (const l of life.lifetimes.slice(-12).reverse()) {
      const row = document.createElement('div'); row.className = 'life-row';
      for (const v of [`G${l.generation}`, `${l.cause} · ${l.age.toFixed(0)} s · ${(l.travelled * 10).toFixed(0)} mm`, `${l.tasks} deliv.`, `${l.reward.toFixed(1)} reward`]) { const span = document.createElement('span'); span.textContent = v; row.append(span); }
      panel.append(row);
    }
    const t = life.trend();
    text('comparison', t ? `Early third → latest third of ${t.lifetimes} lifetimes: reward ${t.early.reward.toFixed(1)} → ${t.late.reward.toFixed(1)}, deliveries ${t.early.tasks.toFixed(1)} → ${t.late.tasks.toFixed(1)}, age ${t.early.age.toFixed(0)} → ${t.late.age.toFixed(0)} s. Conditions may differ between lifetimes; this is a measured outcome, not a controlled benchmark.` : 'At least two completed lifetimes are needed to compare outcomes.');
    drawLineage(); lastLifetimeCount = life.lifetimes.length;
  }
  if (panelVisible('strip')) drawStrip();
  if (body) { const q = body.data.qpos as Float64Array; text('position', `${(q[0] * 10).toFixed(1)} / ${(q[1] * 10).toFixed(1)} mm`); habitat.update(life, q[0], q[1], input('heat').checked, input('food').checked); room.requestRender(); }
}

// ---------- the control cycle ----------
async function cycle() {
  const cycleStart = performance.now();
  const pace = Number(select('speed').value);
  const window_ = Number(select('window').value);
  if (pendingWiring) { pendingWiring = false; applyWiring(); }
  const q = body.data.qpos as Float64Array;
  if (!life.state.alive) {
    body.driveLegs(0, 0); await room.advancePhysicsResponsive(80); physicsSeconds += .008;
    life.step(HABITAT_DT, q[0], q[1], false);
    if (life.state.deathAge >= 2) { life.hatch(); await body.reset(); sim.reset(); lastDecision = -100; arrivedFor = 0; prevDistance = NaN; trail.length = 0; escape = null; save(); }
    render(); return;
  }
  // 1. senses (authored encodings of the physical scene into labeled populations)
  const qw = q[3], qx = q[4], qy = q[5], qz = q[6];
  const hx = 1 - 2 * (qy * qy + qz * qz), hy = 2 * (qx * qy + qw * qz);
  const foodOn = input('food').checked;
  const sources: OdorSource[] = PLACES.filter(p => p.channel >= 0).map(p => ({ channel: p.channel, x: p.x, y: p.y, strength: p.id === 'eat' && !foodOn ? 0 : 1, decay: ODOR_DECAY }));
  smelled = smell(sources, q[0], q[1], hx, hy, smelled);
  const retina = room.retinaFrame();
  vision = see(retina.pixels, retina.w, retina.h);
  encode(ext, pops, smelled, vision);
  for (const i of life.lesions) ext[i] = 0;
  if (pulseNeuron >= 0 && neuralMs < pulseUntil) ext[pulseNeuron] = 4; else pulseNeuron = -1;
  sim.setExternalInput(ext);
  // 2. the measured brain
  const t0 = performance.now();
  rates = await withDeadline(sim.captureRollingRate(window_, rates), 20_000, 'The GPU stopped responding. Reload to restore the last saved lineage.'); neuralMs += window_;
  brainMs = performance.now() - t0;
  active = 0; for (const r of rates) if (r > 0) active++;
  const neuralActive = active > 0;
  const pr = populationRates(rates, pops);
  for (const p of POPULATIONS) popHz[p] = (popHz[p] ?? 0) * .5 + pr[p] * .5;
  // 3. goal selection (interoception + population rates + sensed odor)
  const task = select('task').value; const forced = task === 'auto' ? undefined : task as Action;
  const s = life.state;
  const critical = (s.fuel < CRITICAL && s.action !== 'eat') || (s.water < CRITICAL && s.action !== 'drink');
  const goalPlace = PLACES.find(p => p.id === s.action)!;
  const approaching = goalPlace.channel >= 0 && smelled.intensity[goalPlace.channel] > .55; // within ~1 cm: let it arrive
  if ((s.age - lastDecision >= DECISION_INTERVAL && !approaching) || s.age - lastDecision >= 2 * DECISION_INTERVAL || lastDecision < 0 || (critical && s.age - lastDecision > 2)) {
    life.choose(READOUT_POPULATIONS.map(p => popHz[p] ?? 0), smelled.intensity, forced); lastDecision = life.state.age; prevDistance = NaN;
  }
  const place = PLACES.find(p => p.id === life.state.action)!;
  room.setTargetPos(place.x, place.y);
  const distance = room.targetDistance(), angle = room.targetAngle();
  const arrived = distance < place.radius * .85;
  // 4. steering from bilateral brain activity (+ optional coordinate assist)
  // Bilateral features are averaged over ~3 cycles: one 10 ms window over a few hundred cells is noisy.
  const fresh = lateralFeatures(rates, pops, place.channel);
  lateral = lateral.length === fresh.length && prevGoal === life.state.action ? fresh.map((v, i) => lateral[i] * .6 + v * .4) : fresh;
  const goalSignal = place.channel >= 0 ? smelled.intensity[place.channel] : 0;
  // Relative change of the goal plume per cycle, smoothed; reset when the goal changes.
  if (prevGoal !== life.state.action || !Number.isFinite(prevGoalSignal)) { goalTrend = 0; prevGoalSignal = goalSignal; prevGoal = life.state.action; }
  goalTrend = goalTrend * .8 + ((goalSignal - prevGoalSignal) / (goalSignal + .02)) * .2; prevGoalSignal = goalSignal;
  const policyTurn = life.steering.act(lateral, goalSignal, () => life.random(), goalTrend);
  const neuralDrive = neuralActive ? clamp(.35 + Object.values(popHz).reduce((a, b) => a + b, 0) * 15, 0, 1) : 0;
  const assist = Number(input('assist').value) / 100;
  let turn = arrived ? 0 : clamp((1 - assist) * policyTurn + assist * clamp(angle * .65, -1, 1), -1, 1);
  // Authored escape reflex: if the body has not displaced for STUCK_WINDOW cycles (a wall or
  // furniture leg), hold a turn for a while. Not a measured circuit; keeps the experiment moving.
  trail.push([q[0], q[1]]); if (trail.length > STUCK_WINDOW) trail.shift();
  const pinned = trail.length === STUCK_WINDOW && Math.hypot(q[0] - trail[0][0], q[1] - trail[0][1]) < .06;
  // Escape: back away (a body pressed on a wall cannot yaw, contacts cancel the assist), then a
  // quarter turn toward the side whose goal receptors fire more, then a short straight run that
  // carries the body around a corner. Standing at a goal or changing goal never counts as pinned.
  if (arrived || prevGoal !== life.state.action) trail.length = 0;
  const turnCycles = Math.max(3, Math.round(Math.PI / 2 / (Physics.yawAssist * .9 * .016 * pace)));
  let forwardOverride: number | null = null;
  if (pinned && !arrived && !escape) { escape = { phase: 'back', left: Math.round(8 / pace) + 2 }; stuckTurn = Math.abs(lateral[6]) > .05 ? Math.sign(lateral[6]) : life.random() < .5 ? -1 : 1; }
  if (escape) {
    escape.left--; trail.length = 0;
    if (escape.phase === 'back') { turn = 0; forwardOverride = -.6; if (escape.left <= 0) escape = { phase: 'turn', left: turnCycles }; }
    else if (escape.phase === 'turn') { turn = stuckTurn * .9; forwardOverride = neuralDrive * .35; if (escape.left <= 0) escape = { phase: 'straight', left: Math.round(10 / pace) + 2 }; }
    else { turn = 0; if (escape.left <= 0) escape = null; }
  }
  const forward = arrived ? 0 : forwardOverride ?? neuralDrive * .9 * (1 - .6 * Math.abs(turn));
  body.driveLegs(forward, turn);
  // 5. body
  const t1 = performance.now(); await room.advancePhysicsResponsive(160 * pace); physicsSeconds += .016 * pace; bodyMs = performance.now() - t1;
  // Righting reflex: flies right themselves within a fraction of a second. If the thorax's up
  // vector points down for several cycles, restore an upright pose at the same place and heading.
  const up = 1 - 2 * (qx * qx + qy * qy);
  fallen = up < .4 ? fallen + 1 : 0;
  if (fallen >= 2) {
    const yaw = Math.atan2(hy, hx);
    q[2] = body.spawnZ; q[3] = Math.cos(yaw / 2); q[4] = 0; q[5] = 0; q[6] = Math.sin(yaw / 2);
    (body.data.qvel as Float64Array).fill(0, 0, 6); await body.setPose(q, body.data.qvel);
    fallen = 0; falls++; trail.length = 0; if (falls % 5 === 1) life.remember(`Fell over and righted itself (${falls} so far this session)`);
  }
  // 6. rewards and life
  const after = room.targetDistance();
  if (Number.isFinite(prevDistance)) life.steering.learn(clamp((prevDistance - after) * 25, -1, 1) - .02 + (arrived ? .3 : 0));
  prevDistance = after;
  for (let i = 0; i < pace; i++) life.step(HABITAT_DT, q[0], q[1], neuralActive, foodOn, input('heat').checked);
  arrivedFor = arrived && neuralActive ? arrivedFor + HABITAT_DT * pace : 0;
  if (arrivedFor >= 3.1 && !forced) { lastDecision = -100; arrivedFor = 0; }
  if (!Array.from(q.subarray(0, 7)).every(Number.isFinite)) throw Error('Physics became non-finite; lineage saved before further stepping.');
  debug = { cycle: cycles, x: q[0], y: q[1], heading: Math.atan2(hy, hx), goal: life.state.action, angle, distance, goalSignal, trend: goalTrend, up, falls, asym: lateral[6], policyTurn, turn, forward, stuck: escape ? `${escape.phase[0]}${escape.left}` : 0, goalL: place.channel >= 0 ? mean(rates, pops.odorLeft[place.channel]) * 1000 : 0, goalR: place.channel >= 0 ? mean(rates, pops.odorRight[place.channel]) * 1000 : 0, ornL: mean(rates, pops.left.ORN) * 1000, ornR: mean(rates, pops.right.ORN) * 1000, speed: room.bodySpeed() };
  // 7. instruments
  viewer.showLive(rates);
  if (performance.now() - lastInstruments >= 200) {
    refreshInstruments();
    lastInstruments = performance.now();
  }
  strip.push(stripRows.map(r => mean(rates, r.ids))); if (strip.length > STRIP_COLS) strip.shift();
  cycles++; cycleMs = performance.now() - t0;
  if (selected >= 0) selectNeuron(selected);
  if (cycles % 3 === 0 && el<HTMLDetailsElement>('inspector').open) {
    const top: number[] = [];
    for (let i = 0; i < rates.length; i++) if (rates[i] > 0 && (top.length < 6 || rates[i] > rates[top[top.length - 1]])) { top.push(i); top.sort((a, b) => rates[b] - rates[a]); if (top.length > 6) top.length = 6; }
    const host = el('top-neurons'); host.replaceChildren();
    for (const i of top) { const b = document.createElement('button'); b.textContent = `${nameOf(i).split(' · ')[0].split(' (')[0]} #${i} · ${(rates[i] * 1000).toFixed(0)} Hz`; b.onclick = () => selectNeuron(i); host.append(b); }
  }
  if (life.totalSeconds - lastSave > 2 || !life.state.alive) { save(); lastSave = life.totalSeconds; }
  render();
  if (cycles > 5) {
    timingSamples.push({ cycle: performance.now() - cycleStart, brain: brainMs, body: bodyMs });
    if (timingSamples.length > 30) timingSamples.shift();
    const avg = (key: 'cycle' | 'brain' | 'body') => timingSamples.reduce((sum, s) => sum + s[key], 0) / timingSamples.length;
    const metrics = { samples: timingSamples.length, cycleMs: avg('cycle'), brainMs: avg('brain'), bodyMs: avg('body'), pace, window: window_, startupLongestTaskMs, runLongestTaskMs };
    el('clock-cycle').dataset.performance = JSON.stringify(metrics);
    el('clock-cycle').title = `${metrics.cycleMs.toFixed(0)} ms average over ${metrics.samples} cycles`;
    if (benchmark && timingSamples.length === 30) { setRunning(false); text('status', 'Benchmark complete'); }
  }
}
async function loop() {
  if (running && !busy && !document.hidden) { busy = true; try { await cycle(); } catch (error) { stop(error); } finally { busy = false; } }
  if (requestedDeath && !busy) { requestedDeath = false; life.die('experiment intervention'); save(); render(); }
  window.setTimeout(loop, running ? 0 : 120);
}

async function boot() {
  if (!navigator.gpu) throw Error('This habitat needs WebGPU. Use a current Chrome or Edge with hardware acceleration enabled.');
  try {
    const saved = benchmark ? null : localStorage.getItem(SAVE);
    if (saved) { const c = JSON.parse(saved); life.restore(c.life); if (Array.isArray(c.pose) && c.pose.length === 109 && c.pose.every(Number.isFinite)) pose = c.pose; life.remember('Resumed saved lineage'); }
  } catch (error) { text('save-state', `Saved checkpoint could not be read: ${error instanceof Error ? error.message : String(error)}`); }
  // Asset locations: same-origin in development; VITE_* URLs (a public bucket) in deployments that
  // cannot ship 100 MB-class files. Versions come from assets.json for permanent caching.
  const versionFor = await loadManifest();
  const env = import.meta.env;
  const brainUrl = `${env.VITE_BRAIN_URL || '/brain.bin'}${versionFor('brain.bin')}`;
  const metaUrl = `${env.VITE_BRAIN_META_URL || '/brain.meta.json'}${versionFor('brain.meta.json')}`;
  (globalThis as unknown as { __flybodyBundleVersion?: string }).__flybodyBundleVersion = versionFor('flybody.bundle.bin').replace('?v=', '') || undefined;
  // The 126 MB brain downloads while the body loads; both are needed before the loop starts.
  let brainBytes = 0;
  const brainPromise = loadBrain(brainUrl, (n, total) => { brainBytes = n; progressAt = performance.now(); bootBar(.15 + .6 * (total ? n / total : 0)); if (room) progress(`Loading measured brain · ${(n / 1e6).toFixed(0)}${total ? ` / ${(total / 1e6).toFixed(0)}` : ''} MB`); });
  brainPromise.catch(() => {});
  const bodyVersion = releaseAssets.assets.find(asset => asset.file === 'habitat.mjb')!.sha256.slice(0, 12);
  const mjbUrl = env.VITE_HABITAT_MJB_URL || `/habitat.mjb?v=${bodyVersion}`;
  const hasMjb = await fetch(mjbUrl, { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).then(r => r.ok && !(r.headers.get('content-type') || '').includes('text/html')).catch(() => false);
  if (!hasMjb) progress('No compiled habitat model here: compiling the anatomical body with the habitat walls in this tab (slower first load)…');
  body = await Physics.create(m => progress(brainBytes ? `${m} · brain ${(brainBytes / 1e6).toFixed(0)} MB` : m), hasMjb ? new URL(mjbUrl, location.href).href : '', versionFor('flybody.bundle.bin').replace('?v=', ''), hasMjb ? undefined : habitatFixturesXml());
  bootBar(.15);
  if (pose) await body.setPose(new Float64Array(pose));
  room = new Room({ container: el('viewport'), bg: 0x000000, floorColor: 0x16181b, pixelRatio: 1.25, maxFps: 24 }); room.externalClock = true;
  await room.attachPhysics(body); room.hideTarget(); habitat = new Habitat(room); setCamera(benchmark ? 'overview' : 'follow');
  for (const id of ['overview', 'follow', 'macro']) button(id).disabled = false;
  button('overview').onclick = () => setCamera('overview'); button('follow').onclick = () => setCamera('follow'); button('macro').onclick = () => setCamera('macro');
  room.renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); stop('The 3D renderer lost its GPU connection. Reload the saved session.'); });
  room.advancePhysics(0);
  el('loading').classList.add('anatomy-ready');
  el('loading').querySelector('strong')!.textContent = 'Connecting the measured brain';
  progress('Anatomy ready. Reading 139,255 measured neurons…');
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  meta = await fetch(metaUrl, { signal: AbortSignal.timeout(30_000) }).then(r => { if (!r.ok) throw Error('brain.meta.json missing'); return r.json(); });
  const brain = await brainPromise;
  bootBar(.8);
  if (brain.header.numNeurons !== 139255 || brain.header.numEdges !== 15091983) throw Error('Unexpected connectome; no substitute model will be used.');
  progress('Compiling the measured graph for WebGPU…');
  sim = await withDeadline(FlySim.create(brain), 45_000, 'GPU initialization timed out. Reload or try a browser with hardware acceleration.');
  sim.device.lost.then(info => stop(`GPU connection lost: ${info.message}`));
  sim.device.addEventListener('uncapturederror', event => stop(`GPU error: ${event.error.message}`));
  pops = buildPopulations(brain); plasticity = new Plasticity(brain);
  rates = new Float32Array(brain.header.numNeurons); ext = new Float32Array(rates.length);
  progress('Building the 3D brain map…');
  viewer = new FlyViewer(brain, { container: el('brain-view'), pointSize: 850, pointOpacity: .55, bg: 0x000000, pixelRatio: 1.25, maxFps: 30, fitPortrait: true });
  viewer.onPick(i => selectNeuron(i)); viewer.setPreset('iso');
  progress('Summing 15,091,983 measured edges into the connectome matrix…');
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  layout = buildPixelOrder(brain, pops, 512); conn = connectivity(brain, classify(brain, pops));
  matrixImage = new ImageData(layout.width, layout.height); driveBuf = new Float64Array(K * K);
  buildMatrixUi(); drawConn(); bootBar(1);
  buildPopulationRows(); buildBars('q-values', ACTIONS.map(a => PLACES.find(p => p.id === a)!.name)); buildBars('steer-weights', STEER_FEATURE_NAMES); buildStrip();
  if (life.lesions.length || life.synapseGain !== 1) applyWiring();
  input('gain').value = String(Math.round(life.synapseGain * 100)); text('gain-label', `${input('gain').value}%`); input('learn').checked = life.learning;
  for (const id of ['play', 'next', 'reward-plus', 'reward-minus', 'export', 'restore-wiring']) button(id).disabled = false;
  for (const control of document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('.brain-controls button, .brain-controls select, #conn-wiring, #conn-drive')) control.disabled = false;
  input('learn').disabled = false;
  select('task').disabled = false; input('gain').disabled = false; input('import').disabled = false;
  button('play').onclick = () => setRunning(!running);
  button('next').onclick = () => { requestedDeath = true; };
  button('reward-plus').onclick = () => { life.feedback(1); render(); save(); };
  button('reward-minus').onclick = () => { life.feedback(-1); render(); save(); };
  input('learn').onchange = () => { life.learning = input('learn').checked; life.steering.learning = life.learning; life.remember(`Learning ${life.learning ? 'enabled' : 'frozen'}`); save(); };
  input('gain').oninput = () => text('gain-label', `${input('gain').value}%`);
  input('gain').onchange = () => { life.synapseGain = Number(input('gain').value) / 100; pendingWiring = true; life.remember(`Connectome strength set to ${input('gain').value}%`); save(); };
  input('assist').oninput = () => text('assist-label', `${input('assist').value}%`);
  select('task').onchange = () => { lastDecision = -100; life.remember(`Task set: ${select('task').selectedOptions[0].text}`); };
  select('window').onchange = () => life.remember(`Neural window set to ${select('window').value} ms per cycle`);
  habitat.onSelect = action => { select('task').value = action; lastDecision = -100; life.remember(`Assigned ${action} by clicking its habitat zone`); };
  button('overview').onclick = () => setCamera('overview'); button('follow').onclick = () => setCamera('follow'); button('macro').onclick = () => setCamera('macro');
  button('pulse-cell').onclick = () => { if (selected < 0) return; pulseNeuron = selected; pulseUntil = neuralMs + 200; life.remember(`200 ms input pulse to ${nameOf(selected)}`); };
  button('silence-cell').onclick = () => { if (selected < 0 || life.lesions.includes(selected)) return; life.lesions.push(selected); pendingWiring = true; life.remember(`Disconnected ${nameOf(selected)} (inherited intervention)`); selectNeuron(selected); save(); };
  button('restore-wiring').onclick = () => { if (!life.lesions.length && life.synapseGain === 1) return; life.lesions = []; life.synapseGain = 1; input('gain').value = '100'; text('gain-label', '100%'); pendingWiring = true; life.remember('Original measured wiring restored'); if (selected >= 0) selectNeuron(selected); save(); };
  button('export').onclick = () => { save(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(life.checkpoint(), null, 2)], { type: 'application/json' })); a.download = `fly-lineage-g${life.state.generation}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  input('import').onchange = async () => {
    const file = input('import').files?.[0]; if (!file) return; setRunning(false);
    try {
      if (file.size > 3_000_000) throw Error('Checkpoint exceeds 3 MB');
      const candidate = JSON.parse(await file.text()); new Life().restore(candidate);
      while (busy) await new Promise(r => setTimeout(r, 20));
      life.restore(candidate); await body.reset(); sim.reset(); applyWiring();
      input('gain').value = String(Math.round(life.synapseGain * 100)); text('gain-label', `${input('gain').value}%`); input('learn').checked = life.learning;
      lastDecision = -100; lastLifetimeCount = -1; lastMemoryCount = -1; prevDistance = NaN; save(); render(); text('status', 'Lineage imported — resume when ready');
    } catch (error) { text('save-state', `Import rejected: ${error instanceof Error ? error.message : String(error)}`); }
    input('import').value = '';
  };
  window.addEventListener('resize', () => { drawStrip(); drawLineage(); viewer.resize(); });
  if (fatal) return;
  ready = true; readyAt = performance.now(); lastDecision = -100;
  life.remember(`Habitat connected: bilateral senses → ${brain.header.numNeurons.toLocaleString()}-neuron LIF → learned steering + goal readout → jointed body`);
  el('loading').hidden = true; document.body.classList.add('ready'); setRunning(true); render(); drawLineage();
  window.addEventListener('pagehide', save);
  window.addEventListener('workspace-view', () => { room.requestRender(); refreshInstruments(); drawLineage(); });
  void loop();
}
void boot().catch(stop);
