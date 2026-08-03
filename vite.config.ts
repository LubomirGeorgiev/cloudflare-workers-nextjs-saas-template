import vinext from "vinext";
import { defineConfig } from "vite";

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { kvDataAdapter } from "@vinext/cloudflare/cache/kv-data-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { VINEXT_CACHE_PREFIX } from "./src/constants/vinext-cache";
import { analyzeBundle } from "./tools/vite-bundle-analyzer";
import { openApiDocument } from "./tools/openapi-document";
import { getSchedulerQueueName } from "./tools/wrangler-config";

const VINEXT_CACHE_KV_BINDING = "NEXT_INC_CACHE_KV";
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
      // Do NOT pre-bundle next-intl/use-intl: Vite would inline a second copy of
      // use-intl's React context, so the provider and hooks read different
      // IntlContext instances ("context ... was not found"). Excluding keeps one.
      "next-intl",
      "use-intl",
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
      },
    },
    ssr: {
      build: {
        sourcemap: true,
      },
    },
  },
  plugins: [
    openApiDocument(),
    vinext({
      cache: {
        cdn: cdnAdapter(),
        data: kvDataAdapter({
          binding: VINEXT_CACHE_KV_BINDING,
          appPrefix: VINEXT_CACHE_PREFIX,
          ttlSeconds: VINEXT_CACHE_TTL_SECONDS,
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
