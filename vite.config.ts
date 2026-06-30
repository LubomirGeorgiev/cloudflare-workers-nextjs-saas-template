import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { kvDataAdapter } from "@vinext/cloudflare/cache/kv-data-adapter";
import vinext from "vinext";
import { defineConfig } from "vite";
import { analyzeBundle } from "./tools/vite-bundle-analyzer";
import { getSchedulerQueueName } from "./tools/wrangler-config";

const VINEXT_CACHE_KV_BINDING = "NEXT_INC_CACHE_KV";
const VINEXT_CACHE_PREFIX = "vinext-cache";
const VINEXT_CACHE_TTL_SECONDS = 7 * 24 * 3600;

export default defineConfig({
  define: {
    __SCHEDULER_QUEUE_NAME__: JSON.stringify(getSchedulerQueueName()),
  },
  optimizeDeps: {
    include: [
      "use-sync-external-store/shim",
      "use-sync-external-store/shim/with-selector",
    ],
    exclude: [
      // TODO Check if future version of @base-ui are optimized for Vite and remove from this list
      "@base-ui/react",
      "@base-ui/utils",
      "@tiptap/core",
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
      },
    },
    ssr: {
      build: {
        sourcemap: true,
      },
    },
  },
  plugins: [
    vinext({
      cache: {
        data: kvDataAdapter({
          binding: VINEXT_CACHE_KV_BINDING,
          appPrefix: VINEXT_CACHE_PREFIX,
          ttlSeconds: VINEXT_CACHE_TTL_SECONDS,
        }),
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
