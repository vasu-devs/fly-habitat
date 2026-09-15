import test from 'node:test';
import assert from 'node:assert/strict';
import { copyBodyState, type BodyState } from '../src/bodyProtocol.ts';
import { withDeadline } from '../src/deadline.ts';

const state = (x: number): BodyState => ({ qpos: new Float64Array([x, 2, 3]), qvel: new Float64Array([x]), xpos: new Float64Array([x, 0, 0]), xquat: new Float64Array([1, 0, 0, 0]), speed: x });
test('worker snapshots update held pose references across awaited steps', () => {
  const destination = state(0), source = state(7), held = destination.qpos;
  copyBodyState(destination, source);
  assert.equal(destination.qpos, held);
  assert.equal(held[0], 7);
  source.qpos[0] = 99;
  assert.equal(held[0], 7);
  assert.equal(destination.speed, 7);
});
test('incompatible body snapshots are rejected', () => {
  const incompatible = state(1); incompatible.qpos = new Float64Array(2);
  assert.throws(() => copyBodyState(state(0), incompatible), /size changed/);
});
test('stalled asynchronous work fails with an actionable error', async () => {
  await assert.rejects(withDeadline(new Promise(() => {}), 10, 'GPU stalled; reload saved session'), /GPU stalled/);
});
test('completed work returns its result and keeps original errors', async () => {
  assert.equal(await withDeadline(Promise.resolve(42), 100, 'timeout'), 42);
  await assert.rejects(withDeadline(Promise.reject(Error('device lost')), 100, 'timeout'), /device lost/);
});
