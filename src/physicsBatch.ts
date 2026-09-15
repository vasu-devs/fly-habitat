/** Keep every physics substep, but let input and rendering run between batches. */
export async function stepInBatches(total: number, step: (count: number, first: boolean) => void, yieldTask: () => Promise<void>, batch = 32) {
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(batch) || batch < 1) throw new Error('Invalid physics batch');
  for (let done = 0; done < total; done += batch) {
    step(Math.min(batch, total - done), done === 0);
    if (done + batch < total) await yieldTask();
  }
}

let channel: MessageChannel | undefined;
const waiting: (() => void)[] = [];
export function yieldToBrowser(): Promise<void> {
  channel ??= new MessageChannel();
  channel.port1.onmessage = () => waiting.shift()?.();
  return new Promise(resolve => { waiting.push(resolve); channel!.port2.postMessage(null); });
}
