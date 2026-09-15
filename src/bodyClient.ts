import { copyBodyState, type BodyCommand, type BodyReady, type BodyReply, type BodyState } from './bodyProtocol';
import type { FlyMjModel } from './mujocoModel';

/** The main thread owns renderable snapshots; only the worker owns MuJoCo. */
export class BodyClient {
  static readonly yawAssist = 4;
  readonly remote = true;
  model!: FlyMjModel;
  mujoco!: { mjtGeom: BodyReady['types'] };
  data!: BodyState;
  spawnZ = 0;
  private worker = new Worker(new URL('./body.worker.ts', import.meta.url), { type: 'module' });
  private sequence = 0;
  private forward = 0;
  private turn = 0;
  private pending = new Map<number, { resolve: (value?: BodyReady) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; frame?: () => void }>();
  private progress?: (message: string) => void;
  private constructor() {
    this.worker.onmessage = (event: MessageEvent<BodyReply>) => {
      const message = event.data, job = this.pending.get(message.id);
      if (!job) return;
      if (message.kind === 'progress') { this.progress?.(message.message); return; }
      if (message.kind === 'frame' || message.kind === 'done') {
        copyBodyState(this.data, message.state); job.frame?.();
        if (message.kind === 'frame') return;
      }
      clearTimeout(job.timer); this.pending.delete(message.id);
      if (message.kind === 'error') job.reject(Error(message.message));
      else job.resolve(message.kind === 'ready' ? message.value : undefined);
    };
    this.worker.onerror = event => this.dispose(Error(event.message || 'Body worker failed'));
    this.worker.onmessageerror = () => this.dispose(Error('Body snapshot could not be read'));
  }
  static async create(progress: (message: string) => void, url: string, bundleVersion?: string, extraXml?: string) {
    const client = new BodyClient(); client.progress = progress;
    try {
      const ready = (await client.request({ kind: 'init', url, bundleVersion, extraXml }, 180_000))!;
      client.model = ready.model; client.mujoco = { mjtGeom: ready.types }; client.data = ready.state; client.spawnZ = ready.spawnZ;
      return client;
    } catch (error) { client.dispose(); throw error; }
  }
  private request(command: BodyCommand, timeout = 20_000, frame?: () => void): Promise<BodyReady | undefined> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.dispose(Error('The body simulation stopped responding. Reload to restore the last saved lineage.')), timeout);
      this.pending.set(id, { resolve, reject, timer, frame });
      this.worker.postMessage({ ...command, id });
    });
  }
  get bodySpeed() { return this.data.speed; }
  driveLegs(forward: number, turn: number) { this.forward = forward; this.turn = turn; }
  async advance(steps: number, onFrame: () => void) { await this.request({ kind: 'step', steps, forward: this.forward, turn: this.turn }, 20_000, onFrame); }
  async reset() { await this.request({ kind: 'reset' }); }
  async setPose(qpos: Float64Array, qvel?: Float64Array) { await this.request({ kind: 'pose', qpos, qvel }); }
  dispose(error = Error('Body worker closed')) {
    this.worker.terminate();
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
    this.pending.clear();
  }
}
