/**
 * Runs `fn` over every item, at most `batchSize` at a time, and returns the results in order.
 *
 * The bounded alternative to `Promise.all(items.map(...))`: a Worker has a hard subrequest budget
 * and D1/KV fan-out has to stay inside it, so an unbounded list must never be dispatched at once.
 */
export async function mapInBatches<T, R>({
  items,
  batchSize,
  fn,
}: {
  items: readonly T[];
  batchSize: number;
  fn: (item: T, index: number) => Promise<R>;
}): Promise<R[]> {
  const results: R[] = [];

  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);

    results.push(...await Promise.all(batch.map((item, offset) => fn(item, start + offset))));
  }

  return results;
}
