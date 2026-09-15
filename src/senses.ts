// senses.ts — bilateral sensory encoding and population readouts over the
// measured FlyWire graph. Pure module (no GPU, no DOM) so it is unit-testable.
//
// What is measured: neuron soma/centroid positions, cell types and super
// classes come from the FlyWire v783 annotations baked into brain.bin. The
// left/right split uses the medial plane of the positioned brain (median x).
//
// What is authored: which ORNs respond to which habitat odor (channels are
// assigned deterministically by index, because the prepared bin has no
// glomerulus labels), the distance decay of each odor plume, and the small
// bilateral asymmetry between the two antennae. These are documented model
// assumptions, not receptor tuning data.

import type { Brain } from './brain';

export const HERO = { KC: 1, MBON: 2, LHN: 3, PN: 4, ORN: 5, GF: 6, DN: 7 } as const;
export const SUPER = { sensory: 1, ascending: 2, intrinsic: 3, central: 4, descending: 5, motor: 6, endocrine: 7, visualCentrifugal: 8, visualProjection: 9, optic: 10 } as const;

/** Population names reported in the UI, in display order. */
export const POPULATIONS = ['ORN', 'PN', 'LHN', 'KC', 'MBON', 'central', 'visproj', 'optic', 'DN', 'motor'] as const;
export type Population = typeof POPULATIONS[number];
/** Populations for which a bilateral (left − right) asymmetry is read. */
export const LATERAL = ['ORN', 'PN', 'LHN', 'visproj', 'optic', 'DN'] as const;
export type Lateral = typeof LATERAL[number];
export const ODOR_CHANNELS = 5;

export interface Populations {
  medianX: number;
  all: Record<Population, number[]>;
  left: Record<Lateral, number[]>;
  right: Record<Lateral, number[]>;
  /** ORN indices per authored odor channel, split by hemisphere. */
  odorLeft: number[][];
  odorRight: number[][];
  /** Every neuron index that receives some tonic drive (sensory + optic). */
  tonic: number[];
}

function classify(brain: Brain, i: number): Population | null {
  const hero = brain.neurons.cellType[i] & 255, sc = brain.neurons.superClass[i];
  if (hero === HERO.ORN) return 'ORN';
  if (hero === HERO.PN) return 'PN';
  if (hero === HERO.LHN) return 'LHN';
  if (hero === HERO.KC) return 'KC';
  if (hero === HERO.MBON) return 'MBON';
  if (hero === HERO.DN || sc === SUPER.descending) return 'DN';
  if (sc === SUPER.motor) return 'motor';
  if (sc === SUPER.optic) return 'optic';
  if (sc === SUPER.visualProjection) return 'visproj';
  if (sc === SUPER.central) return 'central';
  return null;
}

/** FAFB/FlyWire coordinates are laid out as seen from the front of the head, so the
 * fly's own LEFT hemisphere has the LARGER x. Verified behaviourally: with the opposite
 * assignment the fly steers away from odor sources. */
export function isLeftOf(x: number, medianX: number): boolean { return x > medianX; }

export function buildPopulations(brain: Brain): Populations {
  const N = brain.header.numNeurons;
  const xs: number[] = [];
  for (let i = 0; i < N; i++) { const x = brain.neurons.pos[3 * i]; if (x !== 0) xs.push(x); }
  xs.sort((a, b) => a - b);
  const medianX = xs.length ? xs[xs.length >> 1] : 0;
  const all = Object.fromEntries(POPULATIONS.map(p => [p, [] as number[]])) as Record<Population, number[]>;
  const left = Object.fromEntries(LATERAL.map(p => [p, [] as number[]])) as Record<Lateral, number[]>;
  const right = Object.fromEntries(LATERAL.map(p => [p, [] as number[]])) as Record<Lateral, number[]>;
  const odorLeft = Array.from({ length: ODOR_CHANNELS }, () => [] as number[]);
  const odorRight = Array.from({ length: ODOR_CHANNELS }, () => [] as number[]);
  const tonic: number[] = [];
  let orn = 0;
  for (let i = 0; i < N; i++) {
    const pop = classify(brain, i);
    const sc = brain.neurons.superClass[i];
    if (sc === SUPER.sensory || sc === SUPER.optic) tonic.push(i);
    if (!pop) continue;
    all[pop].push(i);
    const isLeft = isLeftOf(brain.neurons.pos[3 * i], medianX);
    if ((LATERAL as readonly string[]).includes(pop)) (isLeft ? left : right)[pop as Lateral].push(i);
    if (pop === 'ORN') { (isLeft ? odorLeft : odorRight)[orn % ODOR_CHANNELS].push(i); orn++; }
  }
  return { medianX, all, left, right, odorLeft, odorRight, tonic };
}

export interface OdorSource { channel: number; x: number; y: number; strength: number; decay: number }
export interface Smell { left: Float32Array; right: Float32Array; intensity: Float32Array }

/** Antennal asymmetry: fraction of the plume intensity that shifts between
 * antennae when the source is fully lateral. Authored; flies do use bilateral
 * comparisons but the true gain is not taken from data. */
export const LATERAL_GAIN = .5;

/** Odor concentration at both antennae for a fly at (x, y) with unit heading (hx, hy). */
export function smell(sources: OdorSource[], x: number, y: number, hx: number, hy: number, out?: Smell): Smell {
  const s = out ?? { left: new Float32Array(ODOR_CHANNELS), right: new Float32Array(ODOR_CHANNELS), intensity: new Float32Array(ODOR_CHANNELS) };
  s.left.fill(0); s.right.fill(0); s.intensity.fill(0);
  for (const src of sources) {
    if (src.channel < 0 || src.channel >= ODOR_CHANNELS) throw new Error(`odor channel ${src.channel} out of range`);
    const dx = src.x - x, dy = src.y - y, d = Math.hypot(dx, dy);
    const c = src.strength * Math.exp(-d * src.decay);
    if (c <= 0) continue;
    const sin = d > 1e-9 ? (hx * dy - hy * dx) / d : 0; // +1 when source is on the fly's left
    s.intensity[src.channel] += c;
    s.left[src.channel] += c * Math.max(0, 1 + LATERAL_GAIN * sin);
    s.right[src.channel] += c * Math.max(0, 1 - LATERAL_GAIN * sin);
  }
  return s;
}

export interface Vision { left: number; right: number }

/** Mean brightness of the left and right halves of the fly's rendered retina (0..1). */
export function see(pixels: Uint8Array, w: number, h: number): Vision {
  let l = 0, r = 0; const half = w >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; const v = (pixels[o] + pixels[o + 1] + pixels[o + 2]) / 765;
    if (x < half) l += v; else r += v;
  }
  const n = half * h || 1;
  return { left: l / n, right: r / (w - half) / h || 0 };
}

/** Drive levels in ext_input units. With extGain 2 and tau 20 ms the LIF
 * threshold sits near 0.17: REST alone is silent, a faint plume (≈0.07) just
 * crosses threshold on the facing antenna only, and ODOR_SPAN saturates near 80 Hz. */
export const DRIVE = { rest: .15, odorSpan: .3, visionBase: .1, visionSpan: .3, tonic: .2 };

/** Fill `ext` with sensory drive for one control cycle. */
export function encode(ext: Float32Array, pops: Populations, s: Smell, v: Vision): void {
  ext.fill(0);
  for (const i of pops.tonic) ext[i] = DRIVE.tonic;
  for (let c = 0; c < ODOR_CHANNELS; c++) {
    const l = DRIVE.rest + DRIVE.odorSpan * Math.min(1.3, s.left[c]);
    const r = DRIVE.rest + DRIVE.odorSpan * Math.min(1.3, s.right[c]);
    for (const i of pops.odorLeft[c]) ext[i] = l;
    for (const i of pops.odorRight[c]) ext[i] = r;
  }
  const vl = DRIVE.visionBase + DRIVE.visionSpan * v.left, vr = DRIVE.visionBase + DRIVE.visionSpan * v.right;
  for (const i of pops.left.optic) ext[i] = vl;
  for (const i of pops.right.optic) ext[i] = vr;
}

export function mean(rates: Float32Array, ids: number[]): number {
  if (!ids.length) return 0;
  let s = 0; for (const i of ids) s += rates[i]; return s / ids.length;
}

/** Signed bilateral asymmetry in (−1, 1): positive when the left population fires more. */
export function asymmetry(rates: Float32Array, left: number[], right: number[]): number {
  const l = mean(rates, left), r = mean(rates, right);
  return (l - r) / (l + r + 1e-4);
}

/** Population mean rates in spikes per ms (multiply by 1000 for Hz). */
export function populationRates(rates: Float32Array, pops: Populations): Record<Population, number> {
  return Object.fromEntries(POPULATIONS.map(p => [p, mean(rates, pops.all[p])])) as Record<Population, number>;
}

/** Bilateral asymmetries for every lateral population plus the goal odor channel.
 * The ORN feature excludes the goal channel's receptors, so it carries only distractor plumes:
 * otherwise a weight learned while approaching one source keeps steering toward it after the
 * goal has changed (the two features would be collinear during every approach). */
export function lateralFeatures(rates: Float32Array, pops: Populations, goalChannel: number): number[] {
  const f = LATERAL.map(p => p === 'ORN' ? distractorAsymmetry(rates, pops, goalChannel) : asymmetry(rates, pops.left[p], pops.right[p]));
  f.push(goalChannel >= 0 ? asymmetry(rates, pops.odorLeft[goalChannel], pops.odorRight[goalChannel]) : 0);
  return f;
}
function distractorAsymmetry(rates: Float32Array, pops: Populations, goalChannel: number): number {
  let l = 0, r = 0, nl = 0, nr = 0;
  for (let c = 0; c < ODOR_CHANNELS; c++) {
    if (c === goalChannel) continue;
    for (const i of pops.odorLeft[c]) l += rates[i]; nl += pops.odorLeft[c].length;
    for (const i of pops.odorRight[c]) r += rates[i]; nr += pops.odorRight[c].length;
  }
  if (!nl || !nr) return 0;
  l /= nl; r /= nr;
  return (l - r) / (l + r + 1e-4);
}
export const STEER_FEATURE_NAMES = [...LATERAL.map(p => p === 'ORN' ? 'other odors L−R' : `${p} L−R`), 'goal odor L−R'];
