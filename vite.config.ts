import vinext from "vinext";
import { defineConfig } from "vite";

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { kvDataAdapter } from "@vinext/cloudflare/cache/kv-data-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";
import { DATA_CACHE_MEMORY_TTL_MS } from "./src/constants/data-cache.ts";
import { VINEXT_CACHE_PREFIX } from "./src/constants/kv-prefixes.ts";
import { analyzeBundle } from "./tools/vite-bundle-analyzer.ts";
import { openApiDocument } from "./tools/openapi-document.ts";
import { getSchedulerQueueName } from "./tools/wrangler-config.ts";

const VINEXT_VITE_CACHE_DIR = "node_modules/.vite-vinext";
const VINEXT_CACHE_KV_BINDING = "KV_STORE";
const VINEXT_CACHE_TTL_SECONDS = 7 * 24 * 3600;
// Each data-cache read checks one `__tag:` KV key per tag, and a page carries ~8 of them once
// Vinext adds its implicit route tags. The default 5 s re-reads them all on nearly every request;
// this holds them in isolate memory, the same window `memoForMs` holds the entry bodies for.
const VINEXT_TAG_CACHE_TTL_MS = DATA_CACHE_MEMORY_TTL_MS;
// `no_bundle: true` uploads every chunk as its own Worker module, and the isolate pays to load and
// install each one. These groups merge the many tiny chunks.
const STARTUP_CHUNK_PRIORITY = -1;
const LAZY_CHUNK_PRIORITY = -2;

const MARKDOWN_BUILD_ID =
  process.env.GITHUB_SHA?.trim() ||
  process.env.CF_PAGES_COMMIT_SHA?.trim() ||
  Date.now().toString(36);

// Rolldown `codeSplitting` for the two server builds. The `$initial` tag matches only the entry's
// static graph, so the "startup" group takes the cold-start modules and the "lazy" group takes the
// rest. `entriesAware` then splits that rest by the dynamic entries that reach it, which is what
// keeps an `await import()` boundary a boundary. See docs/worker-hot-path-and-bundle-size.md.
// Vinext resolves its cacheability manifest to the literal external "./__vinext_cacheability_manifest.js",
// which rolldown never rewrites per chunk. The startup chunk imports it, so it must sit at the
// bundle root beside the manifest; every other chunk keeps vinext's `_next/static/` path.
const STARTUP_CHUNK_NAME = "startup";
const SERVER_CHUNK_FILE_NAMES = "_next/static/[name]-[hash].js";

function serverChunkFileNames(chunk: { name: string }): string {
  return chunk.name === STARTUP_CHUNK_NAME ? "[name]-[hash].js" : SERVER_CHUNK_FILE_NAMES;
}

function serverCodeSplitting() {
  return {
    groups: [
      // A `tags` group outranks `priority` in rolldown 1.2.5, so this one also takes React from
      // vinext's `framework` group. That group only shields an `app/global-not-found.tsx` from the
      // root layout's CSS (cloudflare/vinext#1549); this app has none. Add one, restore the split.
      { name: STARTUP_CHUNK_NAME, tags: ["$initial" as const], priority: STARTUP_CHUNK_PRIORITY },
      {
        name: "lazy",
        priority: LAZY_CHUNK_PRIORITY,
        // No `entriesAwareMergeThreshold`: it folds a chunk that only `import()` reaches into a
        // static neighbour, which made a throwing optional-peer stub run on every server action.
        entriesAware: true,
      },
    ],
  };
}

export default defineConfig({
  cacheDir: VINEXT_VITE_CACHE_DIR,
  define: {
    __MARKDOWN_BUILD_ID__: JSON.stringify(MARKDOWN_BUILD_ID),
    __SCHEDULER_QUEUE_NAME__: JSON.stringify(getSchedulerQueueName()),
  },
  optimizeDeps: {
    include: [
      "use-sync-external-store/shim",
      "use-sync-external-store/shim/with-selector",
    ],
    exclude: [
      // Do NOT pre-bundle next-intl/use-intl: Vite would inline a second copy of
      // use-intl's React context, so the provider and hooks read different
      // IntlContext instances ("context ... was not found"). Excluding keeps one.
      "next-intl",
      "use-intl",
      "lucide-react",
      // TODO Check if future version of @base-ui are optimized for Vite and remove from this list
      "@base-ui/react",
      "@base-ui/utils",
      "@tiptap/core",
      // Pre-bundling this while its @tiptap/core peer is excluded made the RSC dep
      // optimizer prune the cached chunk mid-request ("file does not exist at
      // .vite/deps_rsc/@tiptap_markdown.js" 500s on /docs/*).
      "@tiptap/markdown",
      "@tiptap/pm",
      "@tiptap/static-renderer",
      "prosemirror-model",
      "prosemirror-state",
      "prosemirror-transform",
      "prosemirror-view",
    ],
  },
  resolve: {
    dedupe: [
      // Collapse next-intl/use-intl to a single physical copy so the IntlContext
      // object is shared between the provider and client hooks (see optimizeDeps).
      "next-intl",
      "use-intl",
      "@tiptap/core",
      "@tiptap/pm",
      "@tiptap/static-renderer",
      "prosemirror-model",
      "prosemirror-state",
      "prosemirror-transform",
      "prosemirror-view",
    ],
  },
  ssr: {
    noExternal: [/^@tiptap\//, /^prosemirror-/],
  },
  environments: {
    rsc: {
      build: {
        sourcemap: true,
        rolldownOptions: {
          output: { codeSplitting: serverCodeSplitting(), chunkFileNames: serverChunkFileNames },
        },
      },
    },
    ssr: {
      build: {
        sourcemap: true,
        rolldownOptions: {
          output: { codeSplitting: serverCodeSplitting(), chunkFileNames: serverChunkFileNames },
        },
      },
    },
  },
  plugins: [
    openApiDocument(),
    vinext({
      cache: {
        data: kvDataAdapter({
          binding: VINEXT_CACHE_KV_BINDING,
          appPrefix: VINEXT_CACHE_PREFIX,
          ttlSeconds: VINEXT_CACHE_TTL_SECONDS,
          tagCacheTtlMs: VINEXT_TAG_CACHE_TTL_MS,
        }),
      },
      // Backs `/_next/image` with the Cloudflare Images binding (env.IMAGES).
      // Handled inside vinext/server/fetch-handler, which worker-entrypoint.ts wraps.
      images: {
        optimizer: imagesOptimizer(),
      },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
    tailwindcss(),
    ...(process.env.ANALYZE_BUNDLE ? [analyzeBundle()] : []),
  ],
});
