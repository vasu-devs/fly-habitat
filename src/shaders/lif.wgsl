// lif.wgsl — fused per-timestep LIF kernel for the FlyWire connectome.
//
// LANES threads cooperate on one neuron's incoming CSR row. Each lane
// strides through the row (k = start + lane, start + lane + LANES, …) so a
// group of lanes reads LANES consecutive col_idx/weight entries per
// iteration — coalesced, unlike one-thread-per-row where every lane of a
// workgroup touches a different cache line. Partial sums are reduced through
// workgroup shared memory; lane 0 then runs the neuron update:
//   1. Advances a two-state alpha synapse so each spike spreads over
//      ~tau_syn (5 ms) instead of being injected as a single-step
//      pulse — matches Shiu et al. 2024 dynamics:
//        g_y[n+1] = g_y[n]·a_syn + g_x[n]
//        g_x[n+1] = g_x[n]·a_syn + delta_in
//        i_syn    = g_y · w_syn
//   2. Adds external drive, integrates Vm with the leaky update,
//      threshold, atomic-OR spike bit into spikes_curr.
//
// Neurons are visited in the degree-sorted order of `rows` (src/schedule.ts)
// so the rows sharing a workgroup have similar length and lanes stay busy.
// Host ping-pongs spikes_prev / spikes_curr each timestep so the gather
// always reads stable last-step state. a_syn is a compile-time const
// rather than a Params field because the kernel is fixed at dt = 1 ms.

struct Params {
  num_neurons      : u32,
  alpha            : f32,   // exp(-dt / tau_m)
  v_thresh         : f32,
  v_reset          : f32,
  v_rest           : f32,
  refractory_steps : u32,
  ext_gain         : f32,
  step             : u32,
  w_syn            : f32,   // calibrated for alpha synapse: ~0.022 mV
};

@group(0) @binding(0) var<uniform>             params      : Params;
@group(0) @binding(1) var<storage, read>       rows        : array<u32>; // 3 per slot: neuron, row_start, row_end (degree-sorted)
@group(0) @binding(2) var<storage, read>       col_idx     : array<u32>;
@group(0) @binding(3) var<storage, read>       weight      : array<f32>;
@group(0) @binding(4) var<storage, read>       spikes_prev : array<u32>;
@group(0) @binding(5) var<storage, read_write> spikes_curr : array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> vm          : array<f32>;
@group(0) @binding(7) var<storage, read_write> refrac      : array<u32>;
@group(0) @binding(8) var<storage, read>       ext_input   : array<f32>;
@group(0) @binding(9) var<storage, read_write> g_x         : array<f32>;
@group(0) @binding(10) var<storage, read_write> g_y        : array<f32>;

// Keep in sync with LIF_WG_SIZE / LIF_LANES in src/sim.ts.
const WG_SIZE : u32 = 128u;
const LANES   : u32 = 16u;
const ROWS_PER_WG : u32 = WG_SIZE / LANES;   // 8 neurons per workgroup

// a_syn = exp(-dt / tau_syn) for dt = 1 ms, tau_syn = 5 ms.
// Const, so it silently assumes SimParams.dtMs = 1 — that host param
// feeds alpha and the refractory step count but not this value. The host
// enforces this via assertValidDt() in src/simParams.ts. Make A_SYN a
// Params field if a different dt is ever used.
const A_SYN  : f32 = 0.81873;

var<workgroup> partial : array<f32, WG_SIZE>;

fn spike_bit(idx : u32) -> f32 {
  let word = spikes_prev[idx >> 5u];
  return f32((word >> (idx & 31u)) & 1u);
}

@compute @workgroup_size(WG_SIZE)
fn step_lif(@builtin(local_invocation_id) lid : vec3<u32>,
            @builtin(workgroup_id) wid : vec3<u32>) {
  let lane  = lid.x % LANES;
  let slot  = wid.x * ROWS_PER_WG + lid.x / LANES;   // schedule slot
  let valid = slot < params.num_neurons;

  // 1. Cooperative synaptic gather over incoming edges. weight[k] is the
  // pre-signed synapse count from build_csr.py.
  var sum : f32 = 0.0;
  if (valid) {
    let row_start = rows[3u * slot + 1u];
    let row_end   = rows[3u * slot + 2u];
    for (var k = row_start + lane; k < row_end; k = k + LANES) {
      sum = sum + weight[k] * spike_bit(col_idx[k]);
    }
  }
  partial[lid.x] = sum;
  workgroupBarrier();
  for (var s = LANES / 2u; s > 0u; s = s >> 1u) {
    if (lane < s) { partial[lid.x] = partial[lid.x] + partial[lid.x + s]; }
    workgroupBarrier();
  }
  if (lane != 0u || !valid) { return; }
  let i = rows[3u * slot];
  let delta_in = partial[lid.x];

  // 2. Advance alpha synapse: g_y uses old g_x, then g_x absorbs new
  // spikes. i_syn is g_y_new × w_syn.
  let gx_old = g_x[i];
  let gy_new = g_y[i] * A_SYN + gx_old;
  let gx_new = gx_old * A_SYN + delta_in;
  g_y[i] = gy_new;
  g_x[i] = gx_new;
  let i_syn = gy_new * params.w_syn;

  // 3. External drive
  let i_in = i_syn + ext_input[i] * params.ext_gain;

  // 4. Refractory
  let r = refrac[i];
  if (r > 0u) {
    refrac[i] = r - 1u;
    vm[i]     = params.v_reset;
    return;
  }

  // 5. Leaky integrate
  let v_old = vm[i];
  let v_new = params.v_rest + params.alpha * (v_old - params.v_rest) + i_in;
  vm[i] = v_new;

  // 6. Threshold + reset
  if (v_new >= params.v_thresh) {
    vm[i]     = params.v_reset;
    refrac[i] = params.refractory_steps;
    let word_i = i >> 5u;
    let bit    = 1u << (i & 31u);
    atomicOr(&spikes_curr[word_i], bit);
  }
}

// Host runs this dispatch first each timestep to zero the spike bitset.
@compute @workgroup_size(64)
fn clear_spikes(@builtin(global_invocation_id) gid : vec3<u32>) {
  let words = (params.num_neurons + 31u) >> 5u;
  let i = gid.x;
  if (i >= words) { return; }
  atomicStore(&spikes_curr[i], 0u);
}
