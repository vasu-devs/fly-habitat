// schedule.ts — degree-sorted dispatch order for the LIF gather kernel.
//
// One GPU thread gathers one neuron's incoming CSR row. Workgroups of 64
// threads finish only when their longest row finishes, and FlyWire in-degrees
// are heavy-tailed (median 69, p99 661, max 10,356). Dispatching neurons in
// natural order costs ~4.1× the edge-iterations of the graph itself; sorting
// by in-degree makes every workgroup nearly uniform. The kernel reads
// (neuron, row_start, row_end) triples instead of row_ptr, so the numerical
// result is identical — only the thread→neuron mapping changes.

/** Returns 3N u32: for schedule slot t, [neuron, row_start, row_end], heaviest rows first. */
export function buildSchedule(rowPtr: Uint32Array): Uint32Array {
  const N = rowPtr.length - 1;
  if (N < 0) throw new Error('rowPtr must have at least one entry');
  const order = new Uint32Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  const degree = (i: number) => rowPtr[i + 1] - rowPtr[i];
  order.sort((a, b) => degree(b) - degree(a) || a - b);
  const rows = new Uint32Array(N * 3);
  for (let t = 0; t < N; t++) {
    const i = order[t];
    rows[3 * t] = i; rows[3 * t + 1] = rowPtr[i]; rows[3 * t + 2] = rowPtr[i + 1];
  }
  return rows;
}

/** Sum over workgroups of (max row length × workgroup size): the edge-iterations the GPU actually spends. */
export function workgroupCost(rowPtr: Uint32Array, order?: Uint32Array, wg = 64): number {
  const N = rowPtr.length - 1;
  let cost = 0;
  for (let g = 0; g < N; g += wg) {
    let m = 0;
    for (let t = g; t < Math.min(N, g + wg); t++) { const i = order ? order[3 * t] : t; m = Math.max(m, rowPtr[i + 1] - rowPtr[i]); }
    cost += m * Math.min(wg, N - g);
  }
  return cost;
}
