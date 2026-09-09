/**
 * Splits `items` into consecutive slices of at most `size`, in order.
 *
 * The shared answer to the two bounds this codebase keeps hitting: SQLite's 100 bound parameters
 * per statement, and the Worker subrequest budget a fan-out has to stay inside.
 */
export function chunk<T>({ items, size }: { items: readonly T[]; size: number }): T[][] {
  const chunks: T[][] = [];

  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }

  return chunks;
}
