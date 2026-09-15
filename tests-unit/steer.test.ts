import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Steering, STEER_DIM, INNATE_STEER, STEER_LIMIT } from '../src/steer.ts';

function lcg(seed = 1) { return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32; }

test('innate policy turns toward the goal odor asymmetry', () => {
  const s = new Steering(); s.learning = false;
  const f = Array(STEER_DIM).fill(0); f[6] = .5;
  assert.ok(s.act(f, 1, lcg()) > .3);
  f[6] = -.5;
  assert.ok(s.act(f, 1, lcg()) < -.3);
  assert.throws(() => s.act([1, 2], 1, lcg()));
});

test('REINFORCE moves weights toward rewarded noise and stays bounded', () => {
  const s = new Steering();
  const rng = lcg(3);
  const f = Array(STEER_DIM).fill(0); f[1] = 1; // only PN asymmetry informative
  let before = s.weights[1];
  for (let k = 0; k < 400; k++) {
    s.act(f, 1, rng);
    // Reward turning left when PN asymmetry is positive: sign of noise decides.
    s.learn(s.lastNoise > 0 ? 1 : -1);
  }
  assert.ok(s.weights[1] > before + .5, `PN weight should grow, got ${s.weights[1]} from ${before}`);
  assert.ok(s.weights.every(w => Math.abs(w) <= STEER_LIMIT));
  assert.ok(s.sigma < .3 && s.sigma >= .06);
  assert.equal(s.updates, 400);
  assert.throws(() => s.learn(NaN));
});

test('frozen learning does not change weights; detach drops the pending step', () => {
  const s = new Steering(); s.learning = false;
  const f = Array(STEER_DIM).fill(.3);
  s.act(f, 1, lcg()); assert.equal(s.learn(5), 0);
  assert.deepEqual(s.weights, INNATE_STEER);
  s.learning = true; s.act(f, 1, lcg()); s.detach(); assert.equal(s.learn(5), 0);
});

test('checkpoint round-trips and rejects corrupt values', () => {
  const s = new Steering(); s.weights[0] = 2; s.updates = 9; s.sigma = .1;
  const copy = new Steering(); copy.restore(s.checkpoint());
  assert.deepEqual(copy.weights, s.weights); assert.equal(copy.updates, 9);
  assert.throws(() => copy.restore({ ...s.checkpoint(), weights: [99, 0, 0, 0, 0, 0, 0] }));
  assert.throws(() => copy.restore({ ...s.checkpoint(), sigma: 0 }));
  assert.throws(() => copy.restore(null));
});

test('a fading goal plume re-enables turning even without bilateral asymmetry', () => {
  const quiet = new Steering(); quiet.learning = false;
  const f = Array(STEER_DIM).fill(0);
  let steady = 0, fading = 0;
  const a = lcg(11), b = lcg(11);
  for (let k = 0; k < 200; k++) { steady += Math.abs(quiet.act(f, .5, a, 0)); }
  const fade = new Steering(); fade.learning = false;
  for (let k = 0; k < 200; k++) { fading += Math.abs(fade.act(f, .5, b, -.05)); }
  assert.ok(steady < 1, `steady turning should be near zero, got ${steady}`);
  assert.ok(fading > steady * 10, `fading plume should drive turning, got ${fading} vs ${steady}`);
});
