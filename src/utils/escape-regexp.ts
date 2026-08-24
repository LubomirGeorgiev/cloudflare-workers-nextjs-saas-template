/** Escapes the characters a `RegExp` treats as syntax, so a value can match itself literally. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
