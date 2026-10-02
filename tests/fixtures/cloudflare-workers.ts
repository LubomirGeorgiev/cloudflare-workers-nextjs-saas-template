// Unit tests run in Node, where `cloudflare:workers` does not exist. A test that needs `env` or
// other exports still mocks the module itself; this stub lets traced code run untraced.
const untracedSpan = {
  isTraced: false,
  recordException: () => untracedSpan,
  setAttribute: () => untracedSpan,
  setAttributes: () => untracedSpan,
};

// oxlint-disable-next-line project/no-unused-module-exports -- vitest.unit.config.ts aliases `cloudflare:workers` here.
export const tracing = {
  enterSpan: <T, A extends unknown[]>(
    _name: string,
    callback: (span: typeof untracedSpan, ...args: A) => T,
    ...args: A
  ): T => callback(untracedSpan, ...args),
  getActiveSpan: () => undefined,
};

// Empty, like local workerd: no bindings, and no `cache.purge`. A purge after a CMS write then
// skips instead of throwing in every test that runs the real invalidation path.
// oxlint-disable-next-line project/no-unused-module-exports -- vitest.unit.config.ts aliases `cloudflare:workers` here.
export const env = {};
// oxlint-disable-next-line project/no-unused-module-exports -- vitest.unit.config.ts aliases `cloudflare:workers` here.
export const cache = {};
