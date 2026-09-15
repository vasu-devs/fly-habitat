import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepInBatches } from '../src/physicsBatch.ts';

test('responsive stepping preserves 480 substeps and resets sensors only once', async () => {
  let total = 0, resets = 0, yields = 0;
  await stepInBatches(480, (count, first) => { assert.ok(count <= 32); total += count; resets += Number(first); }, async () => { yields++; });
  assert.equal(total, 480); assert.equal(resets, 1); assert.equal(yields, 14);
});
test('partial batches preserve the remainder without yielding after completion', async () => {
  const events: (number | string)[] = [];
  await stepInBatches(80, count => events.push(count), async () => { events.push('yield'); });
  assert.deepEqual(events, [32, 'yield', 32, 'yield', 16]);
});
test('physics failures stop subsequent batches', async () => {
  let calls = 0;
  await assert.rejects(stepInBatches(480, () => { calls++; throw Error('physics failure'); }, async () => {}), /physics failure/);
  assert.equal(calls, 1);
});
test('habitat render batches keep the complete 48 ms control interval', async () => {
  const counts: number[] = [];
  await stepInBatches(480, count => counts.push(count), async () => {}, 128);
  assert.deepEqual(counts, [128, 128, 128, 96]);
  assert.equal(counts.reduce((a, b) => a + b) * .0001, .048);
});
test('invalid batch parameters cannot enter an infinite loop', async () => {
  await assert.rejects(stepInBatches(32, () => {}, async () => {}, 0), /Invalid/);
  await assert.rejects(stepInBatches(-1, () => {}, async () => {}), /Invalid/);
});
