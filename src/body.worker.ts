import { Physics } from './physics';
import { GEOM_NAMES, MODEL_ARRAYS, type BodyRequest, type BodyReply, type BodyState, type BodyReady } from './bodyProtocol';
import type { FlyMjModel } from './mujocoModel';

let body: Physics;
const reply = (value: BodyReply, transfer: Transferable[] = []) => postMessage(value, { transfer });
function snapshot(): BodyState {
  return { qpos: body.data.qpos.slice(), qvel: body.data.qvel.slice(), xpos: body.data.xpos.slice(), xquat: body.data.xquat.slice(), speed: body.bodySpeed };
}
function sendState(id: number, kind: 'frame' | 'done') {
  const state = snapshot();
  reply({ id, kind, state }, [state.qpos.buffer, state.qvel.buffer, state.xpos.buffer, state.xquat.buffer]);
}
async function handle(request: BodyRequest) {
  const { id } = request;
  try {
    if (request.kind === 'init') {
      Physics.kinematicAssistEnabled = true; Physics.attitudeDamperEnabled = true;
      Physics.yawAssist = 4; Physics.assistUprightOnly = true;
      (globalThis as unknown as { __flybodyBundleVersion?: string }).__flybodyBundleVersion = request.bundleVersion;
      body = await Physics.create(message => reply({ id, kind: 'progress', message }), request.url || undefined, request.extraXml);
      const model = { ngeom: body.model.ngeom, nbody: body.model.nbody } as FlyMjModel;
      const transfers: Transferable[] = [];
      for (const key of MODEL_ARRAYS) {
        const copy = body.model[key].slice();
        (model[key] as unknown) = copy;
        transfers.push(copy.buffer);
      }
      const types = Object.fromEntries(GEOM_NAMES.map(key => [key, { value: body.mujoco.mjtGeom[key].value }])) as BodyReady['types'];
      reply({ id, kind: 'ready', value: { model, types, spawnZ: body.spawnZ, state: snapshot() } }, transfers);
    } else if (request.kind === 'step') {
      if (!Number.isInteger(request.steps) || request.steps < 0 || request.steps > 1280) throw Error('Invalid body step count');
      body.driveLegs(request.forward, request.turn);
      // Every numerical step is retained. Only small pose snapshots cross threads.
      for (let done = 0; done < request.steps; done += 128) {
        body.step(Math.min(128, request.steps - done), done === 0);
        if (done + 128 < request.steps) sendState(id, 'frame');
      }
      sendState(id, 'done');
    } else if (request.kind === 'reset') {
      body.reset(); sendState(id, 'done');
    } else {
      if (request.qpos.length !== body.model.nq || !request.qpos.every(Number.isFinite)) throw Error('Invalid body pose');
      body.data.qpos.set(request.qpos);
      if (request.qvel) {
        if (request.qvel.length !== body.model.nv || !request.qvel.every(Number.isFinite)) throw Error('Invalid body velocity');
        body.data.qvel.set(request.qvel);
      }
      body.mujoco.mj_forward(body.model, body.data); sendState(id, 'done');
    }
  } catch (error) { reply({ id, kind: 'error', message: error instanceof Error ? error.message : String(error) }); }
}
// Serialize commands even while initialization is waiting on network I/O.
let chain = Promise.resolve();
onmessage = (event: MessageEvent<BodyRequest>) => { chain = chain.then(() => handle(event.data)); };
