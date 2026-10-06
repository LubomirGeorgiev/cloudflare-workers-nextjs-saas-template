import { kvDataAdapter } from "@vinext/cloudflare/cache/kv-data-adapter";
import {
  generateCacheAdaptersModule,
  VIRTUAL_CACHE_ADAPTERS,
} from "vinext/internal/cache-adapters";
import type { Plugin } from "vite";

import { DATA_CACHE_MEMORY_TTL_MS } from "../src/constants/data-cache.ts";
import { VINEXT_CACHE_PREFIX } from "../src/constants/kv-prefixes.ts";

const VINEXT_CACHE_KV_BINDING = "KV_STORE";
const VINEXT_CACHE_TTL_SECONDS = 7 * 24 * 3600;
// Each data-cache read checks one `__tag:` KV key per tag, and a page carries ~8 of them once
// Vinext adds its implicit route tags. The default 5 s re-reads them all on nearly every request;
// this holds them in isolate memory, the same window `memoForMs` holds the entry bodies for.
const VINEXT_TAG_CACHE_TTL_MS = DATA_CACHE_MEMORY_TTL_MS;
const RESOLVED_CACHE_ADAPTERS_ID = `\0${VIRTUAL_CACHE_ADAPTERS}`;

// The `cache` option of `vinext()` in `vite.config.ts`.
export const VINEXT_CACHE_CONFIG = {
  data: kvDataAdapter({
    binding: VINEXT_CACHE_KV_BINDING,
    appPrefix: VINEXT_CACHE_PREFIX,
    ttlSeconds: VINEXT_CACHE_TTL_SECONDS,
    tagCacheTtlMs: VINEXT_TAG_CACHE_TTL_MS,
  }),
};

// For test runners without the Vinext plugin: serves Vinext's own generated module from the same
// config, so `runWithDataCache` in `src/utils/data-cache-scope.ts` registers the real KV adapter.
export function vinextCacheAdaptersModule(): Plugin {
  return {
    name: "vinext-cache-adapters-module",
    resolveId(id) {
      return id === VIRTUAL_CACHE_ADAPTERS ? RESOLVED_CACHE_ADAPTERS_ID : undefined;
    },
    load(id) {
      return id === RESOLVED_CACHE_ADAPTERS_ID
        ? generateCacheAdaptersModule(VINEXT_CACHE_CONFIG)
        : undefined;
    },
  };
}
