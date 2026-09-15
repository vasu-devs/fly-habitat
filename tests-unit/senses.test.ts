import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPopulations, smell, see, encode, asymmetry, lateralFeatures, populationRates, ODOR_CHANNELS, DRIVE, STEER_FEATURE_NAMES } from '../src/senses.ts';
import { STEER_DIM } from '../src/steer.ts';
import type { Brain } from '../src/brain.ts';

/** Small synthetic brain: 40 ORNs (20 left, 20 right), 10 PNs, 10 KCs, 20 optic, 4 DNs, 4 unlabeled. */
function fakeBrain(): Brain {
  const spec: [number, number, number][] = []; // [x, cellType, superClass]
  for (let i = 0; i < 40; i++) spec.push([i < 20 ? 100 : 900, 5, 1]);
  for (let i = 0; i < 10; i++) spec.push([i < 5 ? 200 : 800, 4, 4]);
  for (let i = 0; i < 10; i++) spec.push([500 + (i % 2 ? 1 : -1), 1, 4]);
  for (let i = 0; i < 20; i++) spec.push([i < 10 ? 50 : 950, 0, 10]);
  for (let i = 0; i < 4; i++) spec.push([i < 2 ? 300 : 700, 7, 5]);
  for (let i = 0; i < 4; i++) spec.push([0, 0, 0]);
  const N = spec.length;
  const pos = new Float32Array(N * 3), cellType = new Uint32Array(N), superClass = new Uint32Array(N);
  spec.forEach(([x, ct, sc], i) => { pos[3 * i] = x; pos[3 * i + 1] = 1; pos[3 * i + 2] = 1; cellType[i] = ct; superClass[i] = sc; });
  return { header: { version: 1, numNeurons: N, numEdges: 0, flags: 0, voxelToNm: [4, 4, 40] }, neurons: { pos, sign: new Float32Array(N), cellType, superClass, flags: new Uint32Array(N), ntConf: new Float32Array(N) }, rowPtr: new Uint32Array(N + 1), colIdx: new Uint32Array(0), weight: new Float32Array(0) };
}

test('populations split by the medial plane and ORNs spread across odor channels', () => {
  const p = buildPopulations(fakeBrain());
  assert.equal(p.all.ORN.length, 40); assert.equal(p.left.ORN.length, 20); assert.equal(p.right.ORN.length, 20);
  assert.equal(p.left.PN.length, 5); assert.equal(p.right.optic.length, 10);
  assert.equal(p.all.DN.length, 4);
  const perChannel = p.odorLeft.map((l, c) => l.length + p.odorRight[c].length);
  assert.equal(perChannel.reduce((a, b) => a + b, 0), 40);
  assert.ok(perChannel.every(n => n === 8));
  assert.equal(p.tonic.length, 60); // sensory + optic
});

test('smell is stronger on the antenna facing the source and decays with distance', () => {
  const src = [{ channel: 2, x: 0, y: 1, strength: 1, decay: 1 }];
  const ahead = smell(src, 0, 0, 0, 1);        // heading +y, source straight ahead
  assert.ok(Math.abs(ahead.left[2] - ahead.right[2]) < 1e-9);
  const onLeft = smell(src, 0, 0, 1, 0);       // heading +x, source at +y = fly's left
  assert.ok(onLeft.left[2] > onLeft.right[2]);
  const far = smell(src, 0, -3, 0, 1);
  assert.ok(far.intensity[2] < ahead.intensity[2]);
  assert.equal(ahead.intensity[0], 0);
  assert.throws(() => smell([{ channel: ODOR_CHANNELS, x: 0, y: 0, strength: 1, decay: 1 }], 0, 0, 1, 0));
});

test('retina halves are averaged separately', () => {
  const w = 4, h = 2, px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; const v = x < 2 ? 255 : 0; px[o] = px[o + 1] = px[o + 2] = v; px[o + 3] = 255; }
  const v = see(px, w, h);
  assert.ok(Math.abs(v.left - 1) < 1e-9); assert.ok(Math.abs(v.right) < 1e-9);
});

test('encode writes graded lateral drive only to labeled populations', () => {
  const brain = fakeBrain(), p = buildPopulations(brain), ext = new Float32Array(brain.header.numNeurons);
  const s = smell([{ channel: 0, x: 0, y: 1, strength: 1, decay: .5 }], 0, 0, 1, 0);
  encode(ext, p, s, { left: 1, right: 0 });
  const l = p.odorLeft[0][0], r = p.odorRight[0][0];
  assert.ok(ext[l] > ext[r], 'left ORN of channel 0 gets more drive');
  assert.ok(Math.abs(ext[p.odorLeft[1][0]] - DRIVE.rest) < 1e-6, 'unstimulated channel rests');
  assert.ok(ext[p.left.optic[0]] > ext[p.right.optic[0]]);
  assert.equal(ext[p.all.KC[0]], 0);
  assert.equal(ext[brain.header.numNeurons - 1], 0);
});

test('asymmetry and lateral features are signed and bounded', () => {
  const p = buildPopulations(fakeBrain());
  const rates = new Float32Array(p.all.ORN.length + 60);
  for (const i of p.left.ORN) rates[i] = .2;
  const a = asymmetry(rates, p.left.ORN, p.right.ORN);
  assert.ok(a > .99 && a <= 1);
  const f = lateralFeatures(rates, p, 0);
  assert.equal(f.length, STEER_DIM);
  assert.equal(STEER_FEATURE_NAMES.length, STEER_DIM);
  assert.ok(f.every(v => v >= -1 && v <= 1));
  assert.ok(f[6] > 0, 'goal channel asymmetry follows left ORNs');
  // The distractor feature ignores the goal channel: with only channel-0 left receptors active it is zero.
  const only0 = new Float32Array(rates.length); for (const i of p.odorLeft[0]) only0[i] = .2;
  assert.equal(lateralFeatures(only0, p, 0)[0], 0);
  assert.ok(lateralFeatures(only0, p, 1)[0] > .9);
  assert.equal(lateralFeatures(rates, p, -1)[6], 0);
  const pr = populationRates(rates, p);
  assert.ok(pr.ORN > 0 && pr.KC === 0);
});
