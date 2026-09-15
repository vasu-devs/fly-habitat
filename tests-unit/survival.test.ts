import test from 'node:test';
import assert from 'node:assert/strict';
import { Life, READOUT_POPULATIONS } from '../src/life.ts';
import { predatorAt, predationDamage } from '../src/predator.ts';
import { lifetimeReport } from '../src/lifetimeReport.ts';

test('predator damage is periodic, proximity-based, and the refuge is safe', () => {
  const p = predatorAt(13);
  assert.equal(predationDamage(13, p.x, p.y), 32);
  assert.equal(predationDamage(0, 0, 0), 0);
  assert.equal(predationDamage(13, 100, 100), 0);
  for (let age = 0; age < 80; age += .1) assert.equal(predationDamage(age, -.9, -.64), 0);
});
test('predation archives its cause and losses once; an inherited descendant resets exposure', () => {
  const l = new Life(), p = predatorAt(13); l.state.age = 12.9; l.state.health = 1;
  l.steering.weights[1] = 1.5;
  l.step(.1, p.x, p.y, true, true, false, true);
  assert.equal(l.state.alive, false);
  assert.equal(l.lifetimes[0].cause, 'predation');
  assert.equal(l.lifetimes[0].episode?.encounters, 1);
  assert.ok(l.lifetimes[0].episode!.predatorDamage > 0);
  assert.ok(l.lifetimes[0].events!.some(e => e.event.includes('Died: predation')));
  l.die('again'); assert.equal(l.lifetimes.length, 1);
  l.hatch(); assert.equal(l.steering.weights[1], 1.5); assert.equal(l.episode.encounters, 0);
  assert.equal(l.episode.startSteer[1], 1.5);
});
test('disabling predation prevents damage at the same position', () => {
  const l = new Life(), p = predatorAt(13); l.state.age = 12.9;
  l.step(.1, p.x, p.y, true, true, false, false);
  assert.equal(l.state.health, 100); assert.equal(l.episode.encounters, 0);
});
test('lifetime reports use recorded weight differences and preserve immutable baselines', () => {
  const l = new Life(); l.weights[0][1] = .75; l.step(.1, 0, 0, true); l.die('starvation');
  const record = l.lifetimes[0], report = lifetimeReport(record);
  assert.equal(report.changes[0].delta, .75);
  assert.equal(report.attempted[0].seconds, .1);
  l.hatch(); l.weights[0][1] = 2;
  assert.equal(record.weights![0][1], .75); assert.equal(record.episode!.startWeights[0][1], 0);
});
test('birth baselines and generation update counts survive checkpoint restoration', () => {
  const l = new Life(), brain = Array(READOUT_POPULATIONS.length).fill(.1), odor = new Float32Array(5);
  l.choose(brain, odor, 'eat'); l.feedback(1); l.choose(brain, odor, 'drink');
  const resumed = new Life(); resumed.restore(l.checkpoint()); resumed.die('test');
  assert.equal(resumed.lifetimes[0].updates, 1);
  assert.equal(resumed.lifetimes[0].episode!.baselineKnown, true);
  const invalid = l.checkpoint(); invalid.episode!.actionSeconds[0] = -1;
  assert.throws(() => new Life().restore(invalid), /Invalid lifetime record/);
});
