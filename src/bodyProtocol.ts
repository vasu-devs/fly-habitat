import type { FlyMjModel } from './mujocoModel';

export const MODEL_ARRAYS = ['geom_group', 'geom_bodyid', 'geom_type', 'geom_dataid', 'geom_size', 'geom_rgba', 'geom_matid', 'mat_rgba', 'mat_shininess', 'geom_pos', 'geom_quat', 'mesh_vert', 'mesh_normal', 'mesh_texcoord', 'mesh_face', 'mesh_facetexcoord', 'mesh_facenormal', 'mesh_vertadr', 'mesh_vertnum', 'mesh_normaladr', 'mesh_normalnum', 'mesh_texcoordadr', 'mesh_faceadr', 'mesh_facenum'] as const;
export const GEOM_NAMES = ['mjGEOM_PLANE', 'mjGEOM_SPHERE', 'mjGEOM_CAPSULE', 'mjGEOM_CYLINDER', 'mjGEOM_BOX', 'mjGEOM_ELLIPSOID', 'mjGEOM_MESH'] as const;
export type GeomTypes = Record<typeof GEOM_NAMES[number], { value: number }>;
export interface BodyState {
  qpos: Float64Array;
  qvel: Float64Array;
  xpos: Float64Array;
  xquat: Float64Array;
  speed: number;
}
export interface BodyReady { model: FlyMjModel; types: GeomTypes; spawnZ: number; state: BodyState }
export type BodyCommand =
  | { kind: 'init'; url: string; bundleVersion?: string; extraXml?: string }
  | { kind: 'step'; steps: number; forward: number; turn: number }
  | { kind: 'pose'; qpos: Float64Array; qvel?: Float64Array }
  | { kind: 'reset' };
export type BodyRequest = BodyCommand & { id: number };
export type BodyReply =
  | { id: number; kind: 'progress'; message: string }
  | { id: number; kind: 'frame'; state: BodyState }
  | { id: number; kind: 'ready'; value: BodyReady }
  | { id: number; kind: 'done'; state: BodyState }
  | { id: number; kind: 'error'; message: string };

/** Keep these arrays stable: a control cycle holds qpos across an awaited step. */
export function copyBodyState(target: BodyState, source: BodyState) {
  for (const key of ['qpos', 'qvel', 'xpos', 'xquat'] as const) {
    if (target[key].length !== source[key].length) throw Error(`Body snapshot ${key} size changed`);
    target[key].set(source[key]);
  }
  target.speed = source.speed;
}
