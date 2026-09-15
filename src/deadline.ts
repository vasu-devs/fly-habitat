/** A stalled asynchronous operation must surface an actionable error. */
export async function withDeadline<T>(operation: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error(message)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
