import "server-only";

const NODE_ENV_KEY = ["NODE", "ENV"].join("_");

export function readRuntimeNodeEnv(): string | undefined {
  // Vinext/Vite build server code with NODE_ENV set for the build itself, so a
  // direct process.env.NODE_ENV read can be folded into a literal during bundling.
  // That is useful for ordinary production/development branches, but not for code
  // that must observe the Worker runtime env. E2E builds are production-shaped,
  // then Wrangler injects NODE_ENV="test" at runtime. The computed key keeps this
  // lookup opaque to static replacement so those runtime vars remain observable.
  return process.env[NODE_ENV_KEY];
}
