import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Life, PLACES, F, FEATURE_NAMES, READOUT_POPULATIONS } from '../src/life.ts';

const quiet = Array(READOUT_POPULATIONS.length).fill(0);
const noOdor = new Float32Array(5);
const tick = (l: Life, action: string, seconds: number, active = true, food = true, heat = false) => {
  const p = PLACES.find(p => p.id === action)!;
  for (let i = 0; i < seconds * 10; i++) l.step(.1, p.x, p.y, active, food, heat);
};
test('feature vector has one entry per named feature', () => {
  const l = new Life();
  assert.equal(F, FEATURE_NAMES.length);
  assert.equal(l.features(quiet, .5).length, F);
  assert.throws(() => l.features([1, 2], 0));
});
test('food requires proximity, neural activity, and an available food source', () => {
  const l = new Life(); l.state.action = 'eat'; l.state.fuel = 30;
  l.step(1, -1, -1, true); assert.ok(l.state.fuel < 30);
  const before = l.state.fuel; tick(l, 'eat', 1, false); assert.ok(l.state.fuel < before);
  const absent = l.state.fuel; tick(l, 'eat', 1, true, false); assert.ok(l.state.fuel < absent);
  tick(l, 'eat', 3); assert.ok(l.state.fuel > 50); assert.ok(l.state.meals > 0);
});
test('sleep restores rest only at the refuge', () => {
  const l = new Life(); l.state.action = 'sleep'; l.state.rest = 20;
  l.step(1, 0, 0, true); assert.ok(l.state.rest < 20);
  tick(l, 'sleep', 4); assert.ok(l.state.rest > 40); assert.ok(l.state.sleeps > 0);
});
test('pollen task requires collection and physical delivery; egg needs fertility', () => {
  const l = new Life(); l.state.fertility = 0; l.state.action = 'nest'; tick(l, 'nest', 3); assert.equal(l.eggs.length, 0);
  l.state.action = 'forage'; tick(l, 'forage', 3); assert.equal(l.state.pollen, true);
  l.state.action = 'nest'; l.step(1, 0, 0, true); assert.equal(l.state.tasks, 0);
  tick(l, 'nest', 3); assert.equal(l.state.tasks, 1); assert.equal(l.state.pollen, false);
  l.state.fertility = 90; tick(l, 'nest', 3); assert.equal(l.eggs.length, 1);
});
test('starvation ends a life and archives the cause exactly once', () => {
  const l = new Life(); l.state.fuel = 0; l.state.health = 1; l.step(1, 0, 0, false);
  assert.equal(l.state.alive, false); assert.equal(l.lifetimes[0].cause, 'starvation');
  l.die('another cause'); assert.equal(l.lifetimes.length, 1);
});
test('distance travelled is accumulated per lifetime', () => {
  const l = new Life(); l.step(.1, 0, 0, true); l.step(.1, .3, .4, true);
  assert.ok(Math.abs(l.state.travelled - .5) < 1e-9);
});
test('reward changes the learned readout and inherited weights survive death', () => {
  const l = new Life(); l.choose([.1, .3, .2, .1, 0, 0, 0, 0], noOdor, 'forage'); l.feedback(1); l.choose([.2, .3, .1, .2, 0, 0, 0, 0], noOdor, 'nest');
  assert.ok(l.weights.flat().some(w => w !== 0)); assert.equal(l.updates, 1);
  l.steering.weights[1] = 2;
  l.die('test'); const weights = structuredClone(l.weights); const memories = l.memories.length;
  assert.deepEqual(l.lifetimes[0].weights, weights);
  assert.deepEqual(l.lifetimes[0].steer, l.steering.weights);
  assert.equal(l.hatch(), true); assert.deepEqual(l.weights, weights); assert.equal(l.state.generation, 2);
  assert.equal(l.steering.weights[1], 2, 'steering policy is inherited');
  assert.ok(l.memories.length > memories); assert.equal(l.state.health, 100); assert.equal(l.state.age, 0);
  l.weights[0][0] = 1; assert.deepEqual(l.lifetimes[0].weights, weights);
  assert.equal(l.hatch(), false);
});
test('exploration probability decays over generations and is zero when frozen', () => {
  const l = new Life(); const first = l.epsilon; l.state.generation = 10;
  assert.ok(l.epsilon < first && l.epsilon >= .03);
  l.learning = false; assert.equal(l.epsilon, 0);
});
test('egg hatch consumes an egg and keeps latest parental learning', () => {
  const l = new Life(); l.state.fertility = 90; l.state.action = 'nest'; tick(l, 'nest', 3);
  l.choose(quiet, noOdor, 'nest'); l.feedback(1); l.die('test'); const saved = l.checkpoint();
  l.hatch(); assert.equal(l.eggs.length, 0); assert.deepEqual(l.weights, saved.weights);
  assert.match(l.memories.at(-1)!.event, /Hatched egg/);
});
test('freeze learning preserves weights through reward and death', () => {
  const l = new Life(); l.learning = false; l.choose(quiet, noOdor, 'eat'); l.feedback(10); l.choose(quiet, noOdor, 'eat'); l.die('test');
  assert.ok(l.weights.flat().every(w => w === 0)); assert.equal(l.updates, 0);
});
test('checkpoint round trip preserves state, weights, steering, lesions and settings', () => {
  const l = new Life(); l.choose([.2, .1, .4, .3, 0, 0, 0, 0], noOdor, 'eat'); tick(l, 'eat', 3); l.choose(quiet, noOdor, 'drink'); l.synapseGain = .4;
  l.lesions = [5, 900]; l.steering.weights[0] = -1.5; l.steering.updates = 4;
  const restored = new Life(); restored.restore(JSON.parse(JSON.stringify(l.checkpoint())));
  assert.deepEqual(restored.checkpoint(), l.checkpoint());
  assert.deepEqual(restored.lesions, [5, 900]);
});
test('version-1 lineages migrate into the new readout without losing interoceptive weights', () => {
  const l = new Life(); l.choose(quiet, noOdor, 'eat'); tick(l, 'eat', 3); l.choose(quiet, noOdor, 'eat');
  const v2 = l.checkpoint();
  const v1 = { ...v2, version: 1, model: 'habitat-readout-v1', weights: v2.weights.map(r => [...r.slice(0, 7), 0, 0, 0, 0, 0]), state: (({ travelled, ...s }) => s)(v2.state), lifetimes: [] };
  delete (v1 as Record<string, unknown>).steer; delete (v1 as Record<string, unknown>).lesions;
  const m = new Life(); m.restore(JSON.parse(JSON.stringify(v1)));
  assert.equal(m.weights[0].length, F);
  assert.deepEqual(m.weights[0].slice(0, 7), v2.weights[0].slice(0, 7));
  assert.equal(m.lesions.length, 0); assert.equal(m.checkpoint().version, 2);
});
test('invalid checkpoints cannot overwrite a working lineage', () => {
  const l = new Life(); const before = l.checkpoint(); const corrupt = structuredClone(before); corrupt.weights[0][0] = NaN;
  assert.throws(() => l.restore(corrupt)); assert.deepEqual(l.checkpoint(), before);
  const wrong = structuredClone(before); wrong.state.health = -1; assert.throws(() => l.restore(wrong));
  const badLesion = structuredClone(before); badLesion.lesions = [999999]; assert.throws(() => l.restore(badLesion));
  const badSteer = structuredClone(before); badSteer.steer.weights[0] = 50; assert.throws(() => l.restore(badSteer));
  assert.throws(() => l.restore({ version: 2 }));
});
test('lifespan and thermal damage are actual terminal conditions', () => {
  const age = new Life(); age.state.age = 239.5; age.step(1, 0, 0, false); assert.equal(age.lifetimes[0].cause, 'simulated lifespan');
  const hot = new Life(); hot.state.health = 2; hot.state.action = 'eat'; tick(hot, 'eat', 1, true, true, true); assert.equal(hot.lifetimes[0].cause, 'heat exposure');
});
test('neural population features affect the readout choice when learned weights differ', () => {
  const l = new Life(); l.learning = false; l.state.fuel = l.state.water = l.state.rest = 100; l.state.pollen = true;
  l.weights[0][7] = 5; assert.equal(l.choose([.2, 0, 0, 0, 0, 0, 0, 0], noOdor), 'eat');
  assert.equal(l.choose(quiet, noOdor), 'nest');
});
test('sensed goal odor is a per-candidate feature', () => {
  const l = new Life(); l.learning = false; l.state.fuel = l.state.water = l.state.rest = 100; l.state.pollen = true;
  l.weights[1][F - 1] = 6;
  const odor = new Float32Array(5); odor[1] = 1;
  assert.equal(l.choose(quiet, odor), 'drink');
  assert.equal(l.choose(quiet, noOdor), 'nest');
});
test('reinforcing a task increases its value without modifying measured graph data', () => {
  const l = new Life(); for (let i = 0; i < 30; i++) { l.choose(quiet, noOdor, 'forage'); l.feedback(1); }
  l.choose(quiet, noOdor, 'forage'); assert.ok(l.weights[3][0] > .3); assert.ok(l.updates >= 30);
  assert.ok(l.weights[0].every(w => w === 0));
});
test('trend compares early and late lifetimes', () => {
  const l = new Life(); assert.equal(l.trend(), null);
  for (let g = 0; g < 6; g++) { l.state.tasks = g; l.state.reward = g * 2; l.die('test'); l.hatch(); }
  const t = l.trend()!; assert.equal(t.lifetimes, 6); assert.ok(t.late.tasks > t.early.tasks);
});
