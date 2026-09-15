// matrix.ts — "every neuron is a pixel" layout and population-level
// connectivity, both derived only from the measured graph. Pure module.
//
//  - buildPixelOrder: sorts the 139,255 neurons by population, then hemisphere,
//    so one canvas pixel per neuron shows the whole brain's activity at once.
//  - connectivity: sums signed synaptic weight and edge counts between every
//    pair of populations by walking the CSR once (15M edges).
//  - drive: cheap live estimate of synaptic drive between populations —
//    presynaptic mean rate × measured summed weight. It is not a spike-resolved
//    current (that would be another 15M-edge pass per cycle); it is labeled as
//    an estimate in the UI.

import type { Brain } from './brain';
import { POPULATIONS, isLeftOf, type Populations, type Population } from './senses.ts';

export const MATRIX_LABELS: string[] = [...POPULATIONS, 'other'];
export const K = MATRIX_LABELS.length;

export interface PixelLayout {
  order: Uint32Array;                  // pixel slot → neuron index
  groups: { name: string; start: number; count: number; left: number }[];
  width: number; height: number;
}

/** Population id per neuron: index into MATRIX_LABELS (K-1 = other). */
export function classify(brain: Brain, pops: Populations): Uint8Array {
  const cls = new Uint8Array(brain.header.numNeurons).fill(K - 1);
  POPULATIONS.forEach((p, k) => { for (const i of pops.all[p]) cls[i] = k; });
  return cls;
}

export function buildPixelOrder(brain: Brain, pops: Populations, width = 512): PixelLayout {
  const N = brain.header.numNeurons;
  const cls = classify(brain, pops);
  const order = new Uint32Array(N);
  const groups: PixelLayout['groups'] = [];
  let slot = 0;
  for (let k = 0; k < K; k++) {
    const left: number[] = [], right: number[] = [];
    for (let i = 0; i < N; i++) if (cls[i] === k) (isLeftOf(brain.neurons.pos[3 * i], pops.medianX) ? left : right).push(i);
    const start = slot;
    for (const i of left) order[slot++] = i;
    for (const i of right) order[slot++] = i;
    groups.push({ name: MATRIX_LABELS[k], start, count: left.length + right.length, left: left.length });
  }
  return { order, groups, width, height: Math.ceil(N / width) };
}

export interface Connectivity { weight: Float64Array; count: Uint32Array; excit: Float64Array; inhib: Float64Array }

/** Summed signed weight, edge count, and excitatory/inhibitory totals for every pre→post population pair. */
export function connectivity(brain: Brain, cls: Uint8Array): Connectivity {
  const weight = new Float64Array(K * K), excit = new Float64Array(K * K), inhib = new Float64Array(K * K);
  const count = new Uint32Array(K * K);
  const { rowPtr, colIdx, weight: w } = brain;
  for (let post = 0; post < brain.header.numNeurons; post++) {
    const kp = cls[post];
    for (let e = rowPtr[post]; e < rowPtr[post + 1]; e++) {
      const v = w[e]; if (v === 0) continue;
      const idx = cls[colIdx[e]] * K + kp;
      weight[idx] += v; count[idx]++;
      if (v > 0) excit[idx] += v; else inhib[idx] -= v;
    }
  }
  return { weight, count, excit, inhib };
}

/** Live estimate: mean presynaptic rate (spikes/ms) × summed weight, per pre→post pair. */
export function drive(rates: Float32Array, pops: Populations, conn: Connectivity, out: Float64Array = new Float64Array(K * K)): Float64Array {
  const rate = new Float64Array(K);
  POPULATIONS.forEach((p, k) => { const ids = pops.all[p]; let s = 0; for (const i of ids) s += rates[i]; rate[k] = ids.length ? s / ids.length : 0; });
  for (let pre = 0; pre < K; pre++) for (let post = 0; post < K; post++) out[pre * K + post] = rate[pre] * conn.weight[pre * K + post];
  return out;
}

/** Amber activity ramp shared with the 3D viewer; returns [r, g, b] in 0..255. */
export function rampColor(rate: number): [number, number, number] {
  const t = Math.min(1, Math.sqrt(rate * 20));
  if (t <= 0) return [19, 24, 29];
  if (t < .5) { const u = t * 2; return [19 + u * (150 - 19), 24 + u * (60 - 24), 29 + u * (50 - 29)]; }
  const u = (t - .5) * 2; return [150 + u * (245 - 150), 60 + u * (200 - 60), 50 + u * (90 - 50)];
}

/** Paint one pixel per neuron into an RGBA buffer of width×height. */
export function paintNeuronMatrix(image: Uint8ClampedArray, rates: Float32Array, layout: PixelLayout): void {
  const { order, width, height } = layout;
  const total = width * height;
  for (let slot = 0; slot < total; slot++) {
    const o = slot * 4;
    if (slot >= order.length) { image[o] = 11; image[o + 1] = 14; image[o + 2] = 17; image[o + 3] = 255; continue; }
    const [r, g, b] = rampColor(rates[order[slot]]);
    image[o] = r; image[o + 1] = g; image[o + 2] = b; image[o + 3] = 255;
  }
}

export type MatrixPopulation = Population | 'other';
