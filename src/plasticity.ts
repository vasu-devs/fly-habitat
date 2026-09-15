import type { Brain } from './brain.ts';

/** An explicitly experimental rule over measured edges, not a dopamine model. */
export class Plasticity {
  readonly gains = new Map<number, number>();
  readonly lesions = new Set<number>();
  readonly eligible: { edge: number; pre: number; post: number }[] = [];
  readonly brain: Brain;
  constructor(brain: Brain) {
    this.brain = brain;
    for (let post = 0; post < brain.header.numNeurons; post++) {
      if ((brain.neurons.cellType[post] & 255) !== 2) continue;
      for (let edge = brain.rowPtr[post]; edge < brain.rowPtr[post + 1]; edge++) {
        const pre = brain.colIdx[edge];
        if ((brain.neurons.cellType[pre] & 255) === 1 && brain.weight[edge] !== 0)
          this.eligible.push({ edge, pre, post });
      }
    }
  }
  teach(rates: Float32Array, reward: number): number {
    if (!Number.isFinite(reward) || Math.abs(reward) !== 1) throw new Error('Teaching pulse must be +1 or −1');
    let changed = 0;
    for (const { edge, pre, post } of this.eligible) {
      if (this.lesions.has(pre) || this.lesions.has(post) || rates[pre] <= 0 || rates[post] <= 0) continue;
      const old = this.gains.get(edge) ?? 1;
      const gain = Math.max(.25, Math.min(2, old + reward * .05 * Math.min(1, rates[pre] * 10) * Math.min(1, rates[post] * 10)));
      if (gain !== old) { this.gains.set(edge, gain); changed++; }
    }
    return changed;
  }
  weights(): Float32Array {
    const weights = this.brain.weight.slice();
    for (const [edge, gain] of this.gains) weights[edge] *= gain;
    if (this.lesions.size) for (let post = 0; post < this.brain.header.numNeurons; post++) {
      const disconnected = this.lesions.has(post);
      for (let e = this.brain.rowPtr[post]; e < this.brain.rowPtr[post + 1]; e++)
        if (disconnected || this.lesions.has(this.brain.colIdx[e])) weights[e] = 0;
    }
    return weights;
  }
  reset() { this.gains.clear(); this.lesions.clear(); }
  checkpoint() { return { version: 1, dataset: 'brain-6419c41e66e2', gains: [...this.gains], lesions: [...this.lesions] }; }
  restore(value: unknown) {
    const v = value as ReturnType<Plasticity['checkpoint']>;
    if (!v || v.version !== 1 || v.dataset !== 'brain-6419c41e66e2' || !Array.isArray(v.gains) || !Array.isArray(v.lesions)) throw new Error('Incompatible checkpoint');
    const eligible = new Set(this.eligible.map(e => e.edge));
    if (v.gains.some(pair => !Array.isArray(pair) || pair.length !== 2 || !eligible.has(pair[0]) || !Number.isFinite(pair[1]) || pair[1] < .25 || pair[1] > 2) ||
        v.lesions.some(i => !Number.isInteger(i) || i < 0 || i >= this.brain.header.numNeurons)) throw new Error('Invalid checkpoint values');
    this.reset();
    for (const [edge, gain] of v.gains) this.gains.set(edge, gain);
    for (const i of v.lesions) this.lesions.add(i);
  }
}
