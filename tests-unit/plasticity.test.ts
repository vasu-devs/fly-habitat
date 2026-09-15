import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Plasticity } from '../src/plasticity.ts';
import type { Brain } from '../src/brain.ts';

function fixture(): Brain {
  // 0 KC, 1 MBON, 2 unrelated. Measured incoming edges: 0→1, 2→1, 1→2.
  return { header: { version: 1, numNeurons: 3, numEdges: 3, flags: 1, voxelToNm: [4, 4, 40] },
    neurons: { pos: new Float32Array(9), sign: new Float32Array([1, -1, 1]), cellType: new Uint32Array([1, 2, 0]), superClass: new Uint32Array(3), flags: new Uint32Array(3), ntConf: new Float32Array(3) },
    rowPtr: new Uint32Array([0, 0, 2, 3]), colIdx: new Uint32Array([0, 2, 1]), weight: new Float32Array([-2, 5, -3]) };
}
test('teaching changes only co-active existing KC→MBON edges and preserves signs and baseline', () => {
  const b = fixture(), p = new Plasticity(b);
  assert.equal(p.teach(new Float32Array([.1, 0, .1]), 1), 0);
  assert.equal(p.teach(new Float32Array([.1, .1, .1]), 1), 1);
  assert.ok(p.weights()[0] < -2); assert.deepEqual([...p.weights()].slice(1), [5, -3]);
  assert.deepEqual([...b.weight], [-2, 5, -3]);
  for (let i = 0; i < 100; i++) p.teach(new Float32Array([1, 1, 1]), 1);
  assert.equal(p.gains.get(0), 2);
});
test('disconnect removes incoming and outgoing edges, including after teaching; restore is exact', () => {
  const p = new Plasticity(fixture()); p.teach(new Float32Array([1, 1, 1]), 1); p.lesions.add(1);
  assert.deepEqual([...p.weights()], [0, 0, 0]); assert.equal(p.teach(new Float32Array([1, 1, 1]), 1), 0);
  p.reset(); assert.deepEqual([...p.weights()], [-2, 5, -3]);
});
test('zero functional weights stay zero; checkpoint cannot add edges or partially corrupt state', () => {
  const b = fixture(); b.weight[0] = 0; assert.equal(new Plasticity(b).eligible.length, 0);
  const p = new Plasticity(fixture()); p.teach(new Float32Array([1, 1, 1]), 1);
  const checkpoint = p.checkpoint(); const q = new Plasticity(fixture()); q.restore(checkpoint);
  assert.deepEqual([...p.weights()], [...q.weights()]);
  assert.throws(() => q.restore({ ...checkpoint, gains: [[1, 2]] }), /Invalid/);
  assert.deepEqual(q.checkpoint(), checkpoint);
  assert.throws(() => q.restore({ ...checkpoint, dataset: 'different' }), /Incompatible/);
});
