// oxlint-disable project/no-unused-module-exports -- Vite aliases this file as @paralleldrive/cuid2.

let nextId = 0;

export function createId(): string {
  nextId += 1;
  return `test_id_${nextId}`;
}

export function init({ length = 24 }: { length?: number } = {}) {
  return () => createId().padEnd(length, "0").slice(0, length);
}

export function getConstants() {
  return {};
}

export function isCuid(value: string): boolean {
  return value.length > 0;
}
