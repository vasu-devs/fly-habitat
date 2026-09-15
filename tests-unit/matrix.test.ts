import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPopulations } from '../src/senses.ts';
import { buildPixelOrder, classify, connectivity, drive, paintNeuronMatrix, rampColor, K, MATRIX_LABELS } from '../src/matrix.ts';
import type { Brain } from '../src/brain.ts';

/** 6 neurons: 2 ORN (L,R), 2 KC, 1 DN, 1 unlabeled; edges ORN→KC (+), KC→DN (+ and −). */
function tiny(): Brain {
  const N = 6;
  const pos = new Float32Array(N * 3); const cellType = new Uint32Array(N); const superClass = new Uint32Array(N);
  const spec: [number, number, number][] = [[100, 5, 1], [900, 5, 1], [100, 1, 4], [900, 1, 4], [500, 7, 5], [0, 0, 0]];
  spec.forEach(([x, ct, sc], i) => { pos[3 * i] = x; pos[3 * i + 1] = 1; pos[3 * i + 2] = 1; cellType[i] = ct; superClass[i] = sc; });
  // incoming CSR: neuron 2 (KC) ← 0,1 ; neuron 3 (KC) ← 1 ; neuron 4 (DN) ← 2 (+3), 3 (−1)
  const rowPtr = new Uint32Array([0, 0, 0, 2, 3, 5, 5]);
  const colIdx = new Uint32Array([0, 1, 1, 2, 3]);
  const weight = new Float32Array([2, 4, 1, 3, -1]);
  return { header: { version: 1, numNeurons: N, numEdges: 5, flags: 0, voxelToNm: [4, 4, 40] }, neurons: { pos, sign: new Float32Array(N), cellType, superClass, flags: new Uint32Array(N), ntConf: new Float32Array(N) }, rowPtr, colIdx, weight };
}

test('pixel order groups by population then hemisphere and covers every neuron once', () => {
  const brain = tiny(); const layout = buildPixelOrder(brain, buildPopulations(brain), 4);
  assert.equal(layout.order.length, 6); assert.equal(layout.width, 4); assert.equal(layout.height, 2);
  assert.deepEqual([...new Set(layout.order)].length, 6);
  const orn = layout.groups.find(g => g.name === 'ORN')!; assert.equal(orn.count, 2); assert.equal(orn.left, 1);
  assert.equal(layout.order[orn.start], 1, 'left ORN (larger x) comes first');
  assert.equal(layout.groups.find(g => g.name === 'other')!.count, 1);
  assert.equal(layout.groups.length, K); assert.equal(MATRIX_LABELS.length, K);
});

test('connectivity sums signed weights and counts per population pair', () => {
  const brain = tiny(); const cls = classify(brain, buildPopulations(brain));
  const c = connectivity(brain, cls);
  const id = (a: string, b: string) => MATRIX_LABELS.indexOf(a) * K + MATRIX_LABELS.indexOf(b);
  assert.equal(c.weight[id('ORN', 'KC')], 7); assert.equal(c.count[id('ORN', 'KC')], 3);
  assert.equal(c.weight[id('KC', 'DN')], 2); assert.equal(c.excit[id('KC', 'DN')], 3); assert.equal(c.inhib[id('KC', 'DN')], 1);
  assert.equal(c.count.reduce((a, b) => a + b, 0), 5);
});

test('drive scales measured weight by presynaptic rate', () => {
  const brain = tiny(); const pops = buildPopulations(brain); const c = connectivity(brain, classify(brain, pops));
  const rates = new Float32Array(6); rates[0] = .5; rates[1] = .1; // ORN mean .3
  const d = drive(rates, pops, c);
  const id = (a: string, b: string) => MATRIX_LABELS.indexOf(a) * K + MATRIX_LABELS.indexOf(b);
  assert.ok(Math.abs(d[id('ORN', 'KC')] - .3 * 7) < 1e-5);
  assert.equal(d[id('KC', 'DN')], 0);
});

test('neuron matrix paints one pixel per neuron with the activity ramp', () => {
  const brain = tiny(); const layout = buildPixelOrder(brain, buildPopulations(brain), 4);
  const rates = new Float32Array(6); rates[4] = 1;
  const img = new Uint8ClampedArray(layout.width * layout.height * 4);
  paintNeuronMatrix(img, rates, layout);
  const hot = layout.order.indexOf(4);
  assert.deepEqual([...img.subarray(hot * 4, hot * 4 + 3)], rampColor(1).map(Math.round));
  assert.equal(img[7 * 4 + 3], 255, 'padding pixels are opaque');
  assert.ok(rampColor(0)[0] < rampColor(.01)[0] && rampColor(.01)[0] < rampColor(1)[0]);
});
