declare const __MARKDOWN_BUILD_ID__: string;

// No fallback on purpose: without the build id every deploy would share one key space, so the
// implicit purge on deploy would stop happening silently. `vite.config.ts` injects the value.
export function getBuildId(): string {
  const injected = __MARKDOWN_BUILD_ID__.trim();

  if (!injected) {
    throw new Error("Build id was not injected by the build.");
  }

  return injected;
}
