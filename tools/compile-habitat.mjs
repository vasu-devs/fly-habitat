// Compile with the exact WASM runtime used by the browser (MJB is version specific).
import fs from 'node:fs';
import crypto from 'node:crypto';
import loadMujoco from '@mujoco/mujoco';
import { patchActuatorFilters } from '../src/mjcfPatch.ts';
import { HABITAT_BOXES, habitatFixturesXml } from '../src/habitatFixtures.ts';

const bytes = fs.readFileSync(new URL('../public/flybody.bundle.bin', import.meta.url));
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
if (bytes.subarray(0, 8).toString() !== 'WGFLYBND') throw Error('Invalid body bundle');
const n = view.getUint32(12, true), files = new Map();
for (let i = 0; i < n; i++) {
  const at = 16 + i * 16;
  const nameAt = 16 + n * 16 + view.getUint32(at, true);
  const name = bytes.subarray(nameAt, nameAt + view.getUint32(at + 4, true)).toString();
  const offset = view.getUint32(at + 8, true);
  files.set(name, bytes.subarray(offset, offset + view.getUint32(at + 12, true)));
}
const fly = patchActuatorFilters(files.get('fruitfly.xml').toString());
// Fixture geometry lives in src/habitatFixtures.ts so the browser fallback compiles the same house.
const boxes = HABITAT_BOXES;
const fixtures = habitatFixturesXml();
const floor = files.get('floor.xml').toString().replace('</worldbody>', fixtures + '\n</worldbody>');
const m = await loadMujoco();
const vfs = new m.MjVFS();
for (const [name, data] of files) if (name.endsWith('.obj')) vfs.addBuffer(name, data);
vfs.addBuffer('fruitfly.xml', new TextEncoder().encode(fly));
console.log('Compiling original flybody meshes and habitat collisions…');
const model = m.MjModel.from_xml_string(floor, vfs);
vfs.delete();
if (model.na !== 78) throw Error('Actuator patch failed');
const out = new m.Uint8Buffer(Number(m.mj_sizeModel(model)));
m.mj_saveModel(model, null, out);
const result = Buffer.from(out.GetView());
const dest = new URL('../public/habitat.mjb', import.meta.url);
fs.writeFileSync(dest, result);
fs.writeFileSync(new URL('../public/habitat-model.json', import.meta.url), JSON.stringify({
  runtime: 'MuJoCo 3.8.0 WASM', bytes: result.length,
  sha256: crypto.createHash('sha256').update(result).digest('hex'),
  sourceBundleSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  nq: model.nq, nv: model.nv, nu: model.nu, na: model.na, meshes: model.nmesh,
  fixtures: boxes, note: 'Original flybody anatomy; authored miniature habitat and actuator filters.'
}, null, 2));
// Verify binary round trip before shipping it.
const checkVfs = new m.MjVFS(); checkVfs.addBuffer('habitat.mjb', result);
const checked = m.MjModel.from_binary_path('habitat.mjb', checkVfs);
if (checked.nq !== model.nq || checked.nmesh !== model.nmesh) throw Error('Binary round trip failed');
console.log(`Verified ${result.length} bytes, ${model.nmesh} meshes, ${model.nq} positions, ${model.nu} actuators`);
checked.delete(); checkVfs.delete(); out.delete(); model.delete();
