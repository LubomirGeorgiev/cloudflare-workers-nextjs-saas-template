import "server-only";

import { getPagesClientAssets } from "vinext/server/pages-client-assets";

import { lazyValue } from "@/utils/lazy-value";

// Cloudflare replays the `Link` preloads of an HTML response as a 103 Early Hints response, so the
// browser fetches the render-critical CSS and JS while the Worker is still rendering. The zone
// setting has to be on as well; see the "Early Hints" section of docs/edge-caching.md.

/** Bounds the header. Only assets every page loads belong here, so the real list is far shorter. */
const MAX_CRITICAL_PRELOAD_LINKS = 8;
/** The one component every page renders, so the CSS the build attaches to it is the global sheet. */
const ROOT_SHELL_RESOURCE_ID = "src/components/root-shell.tsx";

interface RscAssetsManifest {
  serverResources?: Record<string, { css?: readonly string[] } | undefined>;
}

function styleLinkValue(href: string): string {
  return `<${href}>; rel="preload"; as="style"`;
}

function moduleLinkValue(href: string): string {
  return `<${href}>; rel="modulepreload"`;
}

// The build owns the hashed file names, so they are read back from the manifest it emits rather
// than written down. The virtual id resolves only inside a Vite build; outside one — a test runner
// importing this module directly — there is simply nothing to preload.
async function readRootShellStyles(): Promise<readonly string[]> {
  try {
    // @ts-expect-error - virtual module emitted by @vitejs/plugin-rsc during the build.
    const manifestModule = await import("virtual:vite-rsc/assets-manifest");
    const manifest = (manifestModule.default ?? {}) as RscAssetsManifest;

    return manifest.serverResources?.[ROOT_SHELL_RESOURCE_ID]?.css ?? [];
  } catch {
    return [];
  }
}

/**
 * The `Link` values for the assets every page needs before it can paint and hydrate, resolved once
 * per isolate. The module list is Vinext's own client bootstrap graph (the rolldown runtime, the
 * React framework chunk and the Vinext runtime chunk); the stylesheet is the root shell's.
 */
// fallow-ignore-next-line unused-export -- Reached through `await import()` in `worker-entrypoint.ts`.
export const getCriticalPreloadLinks = lazyValue(async (): Promise<readonly string[]> => {
  const styles = await readRootShellStyles();
  const modules = getPagesClientAssets().appBootstrapPreinitModules ?? [];

  return [
    ...styles.map(styleLinkValue),
    ...modules.map(moduleLinkValue),
  ].slice(0, MAX_CRITICAL_PRELOAD_LINKS);
});
