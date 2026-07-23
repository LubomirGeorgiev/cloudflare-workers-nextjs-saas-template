import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

const VINEXT_PUBLIC_SHIMS = {
  "next/amp": "amp",
  "next/app": "app",
  "next/cache": "cache",
  "next/compat/router": "compat-router",
  "next/config": "config",
  "next/constants": "constants",
  "next/document": "document",
  "next/dynamic": "dynamic",
  "next/error": "error",
  "next/font/google": "font-google",
  "next/font/local": "font-local",
  "next/form": "form",
  "next/head": "head",
  "next/headers": "headers",
  "next/image": "image",
  "next/legacy/image": "legacy-image",
  "next/link": "link",
  "next/navigation": "navigation",
  "next/offline": "offline",
  "next/og": "og",
  "next/router": "router",
  "next/script": "script",
  "next/server": "server",
  "next/web-vitals": "web-vitals",
} as const;

export const vinextTestAliases = Object.fromEntries(
  Object.entries(VINEXT_PUBLIC_SHIMS).map(([nextModule, shim]) => [
    nextModule,
    fileURLToPath(import.meta.resolve(`vinext/shims/${shim}`)),
  ]),
);

export function rejectNextRuntimeInternals(): Plugin {
  return {
    name: "reject-next-runtime-internals",
    enforce: "pre",
    resolveId(source) {
      if (source === "next" || source === "next/dist" || source.startsWith("next/dist/")) {
        throw new Error(
          `Tests must use Vinext runtime shims; resolving "${source}" from Next.js is forbidden.`,
        );
      }
    },
  };
}
