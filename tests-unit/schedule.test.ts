import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, workgroupCost } from '../src/schedule.ts';

test('schedule covers every neuron exactly once with correct row bounds', () => {
  const rowPtr = new Uint32Array([0, 3, 3, 10, 12, 100, 101]);
  const rows = buildSchedule(rowPtr);
  assert.equal(rows.length, 18);
  const seen = new Set<number>();
  for (let t = 0; t < 6; t++) {
    const i = rows[3 * t];
    assert.equal(rows[3 * t + 1], rowPtr[i]);
    assert.equal(rows[3 * t + 2], rowPtr[i + 1]);
    seen.add(i);
  }
  assert.equal(seen.size, 6);
});

test('schedule is sorted by in-degree, heaviest first, ties by index', () => {
  const rowPtr = new Uint32Array([0, 3, 3, 10, 12, 100, 101]);
  const rows = buildSchedule(rowPtr);
  const order = [0, 1, 2, 3, 4, 5].map(t => rows[3 * t]);
  assert.deepEqual(order, [4, 2, 0, 3, 5, 1]);
});

test('degree sorting lowers workgroup stall cost on a heavy-tailed graph', () => {
  const N = 4096, rowPtr = new Uint32Array(N + 1);
  let seed = 7;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < N; i++) rowPtr[i + 1] = rowPtr[i] + Math.floor(Math.exp(rand() * 7));
  const natural = workgroupCost(rowPtr);
  const sorted = workgroupCost(rowPtr, buildSchedule(rowPtr));
  const edges = rowPtr[N];
  assert.ok(sorted < natural / 2, `sorted ${sorted} should be far below natural ${natural}`);
  assert.ok(sorted >= edges, 'cost can never be below the edge count');
});

test('empty and single-neuron graphs are handled', () => {
  assert.equal(buildSchedule(new Uint32Array([0])).length, 0);
  assert.deepEqual(Array.from(buildSchedule(new Uint32Array([0, 5]))), [0, 0, 5]);
  assert.throws(() => buildSchedule(new Uint32Array([])));
});
