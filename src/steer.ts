// steer.ts — learned steering policy over live bilateral brain activity.
//
// The policy maps left−right population asymmetries (senses.lateralFeatures)
// to a turn command in [−1, 1]. It learns with REINFORCE (Gaussian exploration,
// running-baseline advantage), a standard policy-gradient method; reward is
// the fly's progress toward its current goal, supplied by the environment.
// Weights are inherited across generations and archived at death.
//
// The innate prior — a positive gain on the goal odor channel — is an
// authored starting point so generation 1 can already attempt chemotaxis.

export const STEER_DIM = 7;
export const STEER_LIMIT = 4;
export const INNATE_STEER = [0, 0, 0, 0, 0, 0, 2.2];

export interface SteerCheckpoint { weights: number[]; sigma: number; baseline: number; updates: number }

export class Steering {
  weights = INNATE_STEER.slice();
  /** Exploration noise standard deviation (decays with experience, floor .06). */
  sigma = .22;
  baseline = 0;
  updates = 0;
  learning = true;
  lastFeatures: number[] | null = null;
  lastNoise = 0;
  lastAdvantage = 0;
  private wander = 0;

  /** Turn command for this cycle. A persistent random walk (klinotaxis) is blended in when the
   * goal plume is faint or fading: `trend` is the recent relative change of the goal signal, so a
   * source straight behind — bilaterally invisible — still triggers turning. Authored reflex. */
  act(features: number[], goalSignal: number, random: () => number, trend = 0): number {
    if (features.length !== STEER_DIM) throw new Error(`steering expects ${STEER_DIM} features`);
    let drive = 0;
    for (let i = 0; i < STEER_DIM; i++) drive += this.weights[i] * features[i];
    const noise = this.learning ? gaussian(random) * this.sigma : 0;
    // Ornstein–Uhlenbeck wander keeps exploration coherent when the goal odor is faint.
    this.wander = this.wander * .92 + (random() - .5) * .6;
    const fading = trend < 0 ? Math.min(1, -trend * 60) : 0;
    const lost = Math.max(0, 1 - goalSignal * 4, fading);
    this.lastFeatures = features.slice(); this.lastNoise = noise;
    return Math.tanh(drive + noise + lost * this.wander);
  }

  /** Policy-gradient update from the reward earned after the last `act`. */
  learn(reward: number): number {
    if (!Number.isFinite(reward)) throw new Error('reward must be finite');
    const f = this.lastFeatures;
    if (!this.learning || !f) return 0;
    const advantage = reward - this.baseline;
    this.baseline += .05 * (reward - this.baseline);
    const scale = .02 * advantage * this.lastNoise / (this.sigma * this.sigma);
    let moved = 0;
    for (let i = 0; i < STEER_DIM; i++) {
      const w = this.weights[i] + scale * f[i];
      const next = Math.max(-STEER_LIMIT, Math.min(STEER_LIMIT, w));
      moved += Math.abs(next - this.weights[i]); this.weights[i] = next;
    }
    this.updates++; this.lastAdvantage = advantage;
    this.sigma = Math.max(.06, this.sigma * .9997);
    return moved;
  }

  checkpoint(): SteerCheckpoint { return { weights: this.weights.slice(), sigma: this.sigma, baseline: this.baseline, updates: this.updates }; }
  restore(c: unknown) {
    const v = c as SteerCheckpoint;
    if (!v || !Array.isArray(v.weights) || v.weights.length !== STEER_DIM || v.weights.some(n => !Number.isFinite(n) || Math.abs(n) > STEER_LIMIT) || !Number.isFinite(v.sigma) || v.sigma < .06 || v.sigma > 1 || !Number.isFinite(v.baseline) || !Number.isInteger(v.updates) || v.updates < 0) throw new Error('Invalid steering checkpoint');
    this.weights = v.weights.slice(); this.sigma = v.sigma; this.baseline = v.baseline; this.updates = v.updates;
    this.lastFeatures = null; this.lastNoise = 0; this.wander = 0;
  }
  /** Forget the pending trajectory step (used at death/hatch so no update crosses lifetimes). */
  detach() { this.lastFeatures = null; this.lastNoise = 0; this.wander = 0; }
}

function gaussian(random: () => number): number {
  const u = Math.max(1e-12, random()), v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
