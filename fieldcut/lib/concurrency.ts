export async function concurrentMap<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer");
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failure: unknown;

  async function worker() {
    while (failure === undefined && nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = await mapper(items[index]!, index);
      } catch (error) {
        failure = error;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  if (failure !== undefined) throw failure;
  return results;
}
