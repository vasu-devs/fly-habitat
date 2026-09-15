/** Authored homeostasis and reinforcement readout, downstream of real neural activity.
 * Units are accelerated habitat seconds, not experimentally calibrated fly lifespans.
 *
 * Two learners live here and are inherited across generations:
 *  - goal selection: linear Q-learning over interoception + eight population
 *    rates from the live FlyWire simulation + the sensed odor of each candidate goal;
 *  - steering (src/steer.ts): REINFORCE over bilateral population asymmetries.
 */
import { Steering } from './steer.ts';
import { predationDamage } from './predator.ts';

export const ACTIONS = ['eat', 'drink', 'sleep', 'forage', 'nest', 'explore'] as const;
export type Action = typeof ACTIONS[number];
/** Odor channel −1 means the place has no plume (the courtyard). */
export interface Place { id: Action; name: string; x: number; y: number; radius: number; channel: number }
export const PLACES: Place[] = [
  { id: 'eat', name: 'Fruit kitchen', x: .9, y: .63, radius: .27, channel: 0 },
  { id: 'drink', name: 'Water garden', x: -.88, y: .62, radius: .26, channel: 1 },
  { id: 'sleep', name: 'Dark refuge', x: -.9, y: -.64, radius: .29, channel: 2 },
  { id: 'forage', name: 'Pollen garden', x: .92, y: -.65, radius: .25, channel: 3 },
  { id: 'nest', name: 'Nursery', x: .22, y: -.74, radius: .23, channel: 4 },
  { id: 'explore', name: 'Courtyard', x: .05, y: .18, radius: .23, channel: -1 },
];
/** Population rates the goal readout sees, in this order (spikes/ms, scaled ×15 and clamped to 1). */
export const READOUT_POPULATIONS = ['ORN', 'PN', 'LHN', 'KC', 'MBON', 'DN', 'optic', 'central'] as const;
export const FEATURE_NAMES = ['bias', 'hunger', 'thirst', 'fatigue', 'injury', 'fertility', 'carrying pollen', ...READOUT_POPULATIONS, 'goal odor'];
export const LIFESPAN = 240;

export interface Memory { generation: number; age: number; event: string }
export interface Episode {
  startWeights: number[][]; startSteer: number[]; startSteerUpdates: number; startGoalUpdates: number; baselineKnown: boolean;
  actionSeconds: number[]; encounters: number; predatorDamage: number; escapes: number; stuckRecoveries: number; falls: number;
  heatSeconds: number; foodAbsentSeconds: number; predatorSeconds: number; assistedSeconds: number;
}
export interface Lifetime { generation: number; age: number; reward: number; meals: number; drinks: number; sleeps: number; tasks: number; eggs: number; cause: string; updates: number; steerUpdates: number; travelled: number; weights?: number[][]; steer?: number[]; episode?: Episode; events?: Memory[] }
export interface Egg { id: number; parent: number; age: number }
export interface LifeState {
  generation: number; age: number; fuel: number; water: number; rest: number; health: number;
  fertility: number; pollen: boolean; alive: boolean; deathAge: number; action: Action;
  meals: number; drinks: number; sleeps: number; tasks: number; eggsLaid: number; reward: number; travelled: number;
}
export interface Checkpoint {
  version: 2; dataset: 'flywire-6419c41e66e2'; model: 'habitat-readout-v2';
  state: LifeState; weights: number[][]; memories: Memory[]; lifetimes: Lifetime[]; eggs: Egg[];
  updates: number; totalSeconds: number; seed: number; synapseGain: number; learning: boolean;
  steer: ReturnType<Steering['checkpoint']>; lesions: number[];
  episode?: Episode;
}
export const F = FEATURE_NAMES.length; // 16
const clamp = (n: number, a = 0, b = 100) => Math.min(b, Math.max(a, n));
const fresh = (generation: number): LifeState => ({ generation, age: 0, fuel: 62, water: 68, rest: 78, health: 100, fertility: 35, pollen: false, alive: true, deathAge: 0, action: 'eat', meals: 0, drinks: 0, sleeps: 0, tasks: 0, eggsLaid: 0, reward: 0, travelled: 0 });
const finiteRow = (row: unknown, n: number, limit: number) => Array.isArray(row) && row.length === n && row.every(v => Number.isFinite(v) && Math.abs(v) <= limit);
const freshEpisode = (weights: number[][], steering: Steering, updates = 0, baselineKnown = true): Episode => ({ startWeights: structuredClone(weights), startSteer: steering.weights.slice(), startSteerUpdates: steering.updates, startGoalUpdates: updates, baselineKnown, actionSeconds: ACTIONS.map(() => 0), encounters: 0, predatorDamage: 0, escapes: 0, stuckRecoveries: 0, falls: 0, heatSeconds: 0, foodAbsentSeconds: 0, predatorSeconds: 0, assistedSeconds: 0 });
const validEpisode = (e: Episode) => e && typeof e.baselineKnown === 'boolean' && Array.isArray(e.startWeights) && e.startWeights.length === 6 && e.startWeights.every(row => finiteRow(row, F, 5)) && finiteRow(e.startSteer, 7, 4) && finiteRow(e.actionSeconds, 6, 1e9) && e.actionSeconds.every(n => n >= 0) && ['startSteerUpdates', 'startGoalUpdates', 'encounters', 'predatorDamage', 'escapes', 'stuckRecoveries', 'falls', 'heatSeconds', 'foodAbsentSeconds', 'predatorSeconds', 'assistedSeconds'].every(k => Number.isFinite(e[k as keyof Episode]) && Number(e[k as keyof Episode]) >= 0);
const validMemory = (m: Memory) => m && typeof m.event === 'string' && m.event.length <= 1000 && Number.isFinite(m.age) && Number.isInteger(m.generation);

export class Life {
  state = fresh(1);
  weights = ACTIONS.map(() => Array<number>(F).fill(0));
  steering = new Steering();
  episode = freshEpisode(this.weights, this.steering);
  private inPredatorContact = false;
  /** Neuron indices whose wiring is disconnected on the GPU. An experimental intervention, inherited. */
  lesions: number[] = [];
  memories: Memory[] = [];
  lifetimes: Lifetime[] = [];
  eggs: Egg[] = [];
  updates = 0;
  totalSeconds = 0;
  seed = 73129;
  synapseGain = 1;
  learning = true;
  lastReward = 0;
  lastError = 0;
  lastScores: number[] = ACTIONS.map(() => 0);
  neuralActivity = 0;
  private lastFeatures: number[] | null = null;
  private lastAction = 0;
  private pendingReward = 0;
  private interaction = 0;
  private lastPlace: Action | null = null;
  private eggCooldown = 0;
  private generationUpdates = 0;
  private lastX = NaN; private lastY = NaN;
  random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  /** Exploration probability decays across generations; descendants exploit inherited knowledge more. */
  get epsilon() { return this.learning ? Math.max(.03, .15 * Math.pow(.88, this.state.generation - 1)) : 0; }
  remember(event: string) {
    this.memories.push({ generation: this.state.generation, age: this.state.age, event });
    if (this.memories.length > 500) this.memories.shift();
  }
  features(neural: number[], goalOdor: number) {
    if (neural.length !== READOUT_POPULATIONS.length) throw Error(`readout expects ${READOUT_POPULATIONS.length} population rates`);
    const s = this.state;
    return [1, (100 - s.fuel) / 100, (100 - s.water) / 100, (100 - s.rest) / 100, (100 - s.health) / 100,
      s.fertility / 100, Number(s.pollen), ...neural.map(n => clamp(n * 15, 0, 1)), clamp(goalOdor, 0, 1)];
  }
  q(a: number, f: number[]) { return this.weights[a].reduce((n, w, i) => n + w * f[i], 0); }
  /** Pick the next goal. `odor[c]` is the sensed intensity of odor channel c; population rates are spikes/ms. */
  choose(neural: number[], odor: ArrayLike<number>, forced?: Action): Action {
    this.neuralActivity = neural.reduce((a, b) => a + b, 0);
    const features = PLACES.map(p => this.features(neural, p.channel >= 0 ? odor[p.channel] : 0));
    this.learn(this.pendingReward, Math.max(...features.map((f, i) => this.q(i, f))));
    this.pendingReward = 0;
    const s = this.state;
    // Innate needs coexist with learned preferences. These priors do not change.
    const priors = [(100 - s.fuel) / 28, (100 - s.water) / 28, (100 - s.rest) / 28,
      s.pollen ? -.6 : .8, s.pollen ? 2.5 : s.fertility > 75 ? 2 : -.5, .1];
    const scores = features.map((f, i) => this.q(i, f) + priors[i]);
    this.lastScores = scores;
    let a = forced ? ACTIONS.indexOf(forced) : scores.indexOf(Math.max(...scores));
    const exploring = !forced && this.random() < this.epsilon;
    if (exploring) a = Math.floor(this.random() * ACTIONS.length);
    this.lastFeatures = features[a]; this.lastAction = a;
    if (s.action !== ACTIONS[a]) {
      this.interaction = 0; this.lastPlace = null;
      this.remember(`Goal → ${PLACES[a].name}; ${forced ? 'visitor assigned' : exploring ? 'exploration' : 'learned value + innate need'} (Q ${this.q(a, features[a]).toFixed(2)}, need ${priors[a].toFixed(2)})`);
    }
    s.action = ACTIONS[a];
    return s.action;
  }
  private learn(reward: number, next: number, terminal = false) {
    this.lastReward = reward;
    if (!this.learning || !this.lastFeatures) return;
    const error = clamp(reward + (terminal ? 0 : .9 * next) - this.q(this.lastAction, this.lastFeatures), -3, 3);
    const norm = 1 + this.lastFeatures.reduce((n, f) => n + f * f, 0);
    this.lastFeatures.forEach((f, i) => { this.weights[this.lastAction][i] = clamp(this.weights[this.lastAction][i] + .15 * error * f / norm, -5, 5); });
    this.updates++; this.generationUpdates++; this.lastError = error;
  }
  reward(value: number) {
    this.pendingReward += value; this.state.reward += value;
    this.lastReward = value;
  }
  feedback(value: number) {
    this.reward(value);
    this.remember(`${value > 0 ? 'Positive' : 'Negative'} reinforcement: ${this.state.action}`);
  }
  step(dt: number, x: number, y: number, neuralActive: boolean, foodAvailable = true, heat = false, predators = false) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 1) throw Error('Life step must be in (0,1]');
    const s = this.state;
    this.totalSeconds += dt;
    for (const egg of this.eggs) egg.age += dt;
    if (!s.alive) { s.deathAge += dt; return; }
    if (Number.isFinite(this.lastX)) s.travelled += Math.hypot(x - this.lastX, y - this.lastY);
    this.lastX = x; this.lastY = y;
    s.age += dt; this.eggCooldown = Math.max(0, this.eggCooldown - dt);
    this.episode.actionSeconds[ACTIONS.indexOf(s.action)] += dt;
    if (heat) this.episode.heatSeconds += dt;
    if (!foodAvailable) this.episode.foodAbsentSeconds += dt;
    if (predators) this.episode.predatorSeconds += dt;
    const p = PLACES.find(p => p.id === s.action)!;
    const arrived = Math.hypot(p.x - x, p.y - y) <= p.radius;
    const acting = arrived && neuralActive;
    const sleeping = acting && s.action === 'sleep';
    s.fuel = clamp(s.fuel - dt * (sleeping ? .1 : .26));
    s.water = clamp(s.water - dt * (sleeping ? .1 : .22));
    s.rest = clamp(s.rest + dt * (sleeping ? 7 : -.3));
    if (s.fuel > 60 && s.water > 60 && s.rest > 40) s.fertility = clamp(s.fertility + dt * .8);
    let damage = (s.fuel === 0 ? 4 : 0) + (s.water === 0 ? 5 : 0) + (s.rest === 0 ? 1 : 0);
    if (heat && x > .4 && y > .15) damage += 8;
    const attack = predators ? predationDamage(s.age, x, y) : 0;
    if (attack > 0) {
      if (!this.inPredatorContact) { this.episode.encounters++; this.remember('Entered the predator footprint; taking damage'); }
      this.episode.predatorDamage += attack * dt;
      this.reward(-attack * dt / 40);
    } else if (this.inPredatorContact) {
      this.episode.escapes++; this.remember('Left the predator footprint alive');
    }
    this.inPredatorContact = attack > 0;
    damage += attack;
    s.health = clamp(s.health + dt * (damage ? -damage : s.fuel > 40 && s.water > 40 ? .4 : 0));
    if (acting) {
      if (this.lastPlace !== s.action) { this.interaction = 0; this.lastPlace = s.action; }
      this.interaction += dt;
      if (s.action === 'eat' && foodAvailable) {
        const before = s.fuel; s.fuel = clamp(s.fuel + dt * 12); this.reward((s.fuel - before) / 45);
      }
      if (s.action === 'drink') { const before = s.water; s.water = clamp(s.water + dt * 15); this.reward((s.water - before) / 45); }
      if (sleeping && s.rest < 98) this.reward(dt * .07);
      if (this.interaction >= 2.5) {
        this.interaction = 0;
        if (s.action === 'eat' && foodAvailable) { s.meals++; this.remember('Ate fruit at the kitchen'); }
        if (s.action === 'drink') { s.drinks++; this.remember('Drank at the water garden'); }
        if (s.action === 'sleep') { s.sleeps++; this.remember('Rested inside the refuge'); }
        if (s.action === 'forage' && !s.pollen) { s.pollen = true; this.reward(.8); this.remember('Collected pollen; delivery target is the nursery'); }
        if (s.action === 'nest' && s.pollen) { s.pollen = false; s.tasks++; s.fertility = clamp(s.fertility + 25); this.reward(2); this.remember('Delivered pollen to the nursery'); }
        if (s.action === 'nest' && s.fertility >= 75 && this.eggs.length < 8 && this.eggCooldown === 0) {
          this.eggs.push({ id: Math.round(this.totalSeconds * 100) + this.eggs.length, parent: s.generation, age: 0 });
          s.eggsLaid++; s.fertility -= 55; this.eggCooldown = 15; this.reward(1.5);
          this.remember('Laid an egg in the nursery');
        }
      }
    } else { this.interaction = 0; this.lastPlace = null; this.reward(-dt * .008); }
    if (s.health === 0) this.die(attack ? 'predation' : heat && x > .4 && y > .15 ? 'heat exposure' : s.water === 0 ? 'dehydration' : s.fuel === 0 ? 'starvation' : 'exhaustion');
    else if (s.age >= LIFESPAN) this.die('simulated lifespan');
  }
  die(cause: string) {
    const s = this.state; if (!s.alive) return;
    this.reward(-2); this.learn(this.pendingReward, 0, true); this.pendingReward = 0; this.lastFeatures = null;
    this.steering.detach();
    s.alive = false; s.health = 0; s.deathAge = 0;
    this.remember(`Died: ${cause}. Learned weights and experiences archived.`);
    this.lifetimes.push({ generation: s.generation, age: s.age, reward: s.reward, meals: s.meals, drinks: s.drinks, sleeps: s.sleeps, tasks: s.tasks, eggs: s.eggsLaid, cause, updates: this.episode.baselineKnown ? this.updates - this.episode.startGoalUpdates : this.generationUpdates, steerUpdates: this.steering.updates, travelled: s.travelled, weights: structuredClone(this.weights), steer: this.steering.weights.slice(), episode: structuredClone(this.episode), events: structuredClone(this.memories.filter(m => m.generation === s.generation).slice(-60)) });
    if (this.lifetimes.length > 100) this.lifetimes.shift();
  }
  hatch() {
    if (this.state.alive) return false;
    const egg = this.eggs.shift();
    this.state = fresh(this.state.generation + 1);
    this.lastFeatures = null; this.pendingReward = 0; this.interaction = 0; this.lastPlace = null; this.generationUpdates = 0; this.lastX = NaN; this.lastY = NaN;
    this.steering.detach();
    this.episode = freshEpisode(this.weights, this.steering, this.updates); this.inPredatorContact = false;
    this.remember(egg ? `Hatched egg from generation ${egg.parent}; inherited latest lineage weights and memories` : 'Experiment reseeded a descendant with inherited weights and memories (no egg)');
    return true;
  }
  /** Summary across archived lifetimes: mean reward and deliveries in the first vs latest third. */
  trend() {
    const l = this.lifetimes; if (l.length < 2) return null;
    const k = Math.max(1, Math.floor(l.length / 3));
    const avg = (rows: Lifetime[], key: 'reward' | 'tasks' | 'age') => rows.reduce((n, r) => n + r[key], 0) / rows.length;
    const early = l.slice(0, k), late = l.slice(-k);
    return { lifetimes: l.length, early: { reward: avg(early, 'reward'), tasks: avg(early, 'tasks'), age: avg(early, 'age') }, late: { reward: avg(late, 'reward'), tasks: avg(late, 'tasks'), age: avg(late, 'age') } };
  }
  checkpoint(): Checkpoint {
    return structuredClone({ version: 2 as const, dataset: 'flywire-6419c41e66e2' as const, model: 'habitat-readout-v2' as const, state: this.state, weights: this.weights, memories: this.memories, lifetimes: this.lifetimes, eggs: this.eggs, updates: this.updates, totalSeconds: this.totalSeconds, seed: this.seed, synapseGain: this.synapseGain, learning: this.learning, steer: this.steering.checkpoint(), lesions: this.lesions, episode: this.episode });
  }
  /** Accepts the current format and migrates version-1 lineages (12-feature readout, no steering). */
  restore(value: unknown, maxNeuron = 139255) {
    const raw = value as Record<string, unknown>;
    if (!raw || raw.dataset !== 'flywire-6419c41e66e2') throw Error('Incompatible learning checkpoint');
    let c: Checkpoint;
    if (raw.version === 1 && raw.model === 'habitat-readout-v1') {
      const old = raw as unknown as Omit<Checkpoint, 'version' | 'model' | 'steer' | 'lesions'>;
      if (!Array.isArray(old.weights) || old.weights.length !== 6 || old.weights.some(r => !finiteRow(r, 12, 5))) throw Error('Incompatible learning checkpoint');
      const weights = old.weights.map(row => [...row.slice(0, 7), ...Array(F - 7).fill(0)]);
      const state = { ...old.state, travelled: 0 };
      const lifetimes = (old.lifetimes || []).map(l => ({ ...l, steerUpdates: 0, travelled: 0, weights: undefined }));
      c = { ...old, version: 2, model: 'habitat-readout-v2', weights, state, lifetimes, steer: new Steering().checkpoint(), lesions: [] };
    } else if (raw.version === 2 && raw.model === 'habitat-readout-v2') c = raw as unknown as Checkpoint;
    else throw Error('Incompatible learning checkpoint');
    if (!Array.isArray(c.weights) || c.weights.length !== 6 || c.weights.some(row => !finiteRow(row, F, 5))) throw Error('Incompatible learning checkpoint');
    const s = c.state;
    if (!s || !ACTIONS.includes(s.action) || typeof s.alive !== 'boolean' || !Number.isInteger(s.generation) || s.generation < 1 || ['age', 'fuel', 'water', 'rest', 'health', 'fertility', 'deathAge', 'meals', 'drinks', 'sleeps', 'tasks', 'eggsLaid', 'reward', 'travelled'].some(k => !Number.isFinite(s[k as keyof LifeState]))) throw Error('Invalid life state');
    if (['fuel', 'water', 'rest', 'health', 'fertility'].some(k => Number(s[k as keyof LifeState]) < 0 || Number(s[k as keyof LifeState]) > 100) || s.age < 0 || typeof s.pollen !== 'boolean') throw Error('Invalid needs');
    if (!Array.isArray(c.memories) || c.memories.length > 500 || c.memories.some(m => !m || typeof m.event !== 'string' || m.event.length > 1000 || !Number.isFinite(m.age) || !Number.isInteger(m.generation))) throw Error('Invalid journal');
    if (!Array.isArray(c.lifetimes) || c.lifetimes.length > 100 || c.lifetimes.some(l => !l || typeof l.cause !== 'string' || ['generation', 'age', 'reward', 'meals', 'drinks', 'sleeps', 'tasks', 'eggs', 'updates', 'steerUpdates', 'travelled'].some(k => !Number.isFinite(l[k as keyof Lifetime])) || (l.weights !== undefined && (!Array.isArray(l.weights) || l.weights.length !== 6 || l.weights.some(row => !finiteRow(row, F, 5)))) || (l.steer !== undefined && !finiteRow(l.steer, 7, 4)))) throw Error('Invalid lineage archive');
    if (!Array.isArray(c.eggs) || c.eggs.length > 8 || c.eggs.some(e => !e || !Number.isFinite(e.id) || !Number.isFinite(e.age) || !Number.isInteger(e.parent))) throw Error('Invalid nursery');
    if ((c.episode && !validEpisode(c.episode)) || c.lifetimes.some(l => (l.episode && !validEpisode(l.episode)) || (l.events && (!Array.isArray(l.events) || l.events.length > 60 || !l.events.every(validMemory))))) throw Error('Invalid lifetime record');
    if (!Number.isInteger(c.updates) || c.updates < 0 || !Number.isFinite(c.totalSeconds) || c.totalSeconds < 0 || !Number.isInteger(c.seed) || !Number.isFinite(c.synapseGain) || c.synapseGain < 0 || c.synapseGain > 1 || typeof c.learning !== 'boolean') throw Error('Invalid checkpoint settings');
    if (!Array.isArray(c.lesions) || c.lesions.length > 5000 || c.lesions.some(i => !Number.isInteger(i) || i < 0 || i >= maxNeuron)) throw Error('Invalid lesion list');
    const steering = new Steering(); steering.restore(c.steer);
    const copy = structuredClone(c);
    this.state = copy.state; this.weights = copy.weights; this.memories = copy.memories; this.lifetimes = copy.lifetimes; this.eggs = copy.eggs;
    this.updates = copy.updates; this.totalSeconds = copy.totalSeconds; this.seed = copy.seed; this.synapseGain = copy.synapseGain; this.learning = copy.learning;
    this.lesions = [...new Set(copy.lesions)]; this.steering = steering; this.steering.learning = this.learning;
    this.episode = copy.episode ?? freshEpisode(this.weights, this.steering, this.updates, false); this.inPredatorContact = false;
    this.lastFeatures = null; this.pendingReward = 0; this.interaction = 0; this.lastPlace = null; this.lastX = NaN; this.lastY = NaN;
  }
}
