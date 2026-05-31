import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import fs from "node:fs";
import vinext from "vinext";
import { defineConfig } from "vite";
import { analyzeBundle } from "./tools/vite-bundle-analyzer";

interface WranglerConfig {
  queues?: {
    producers?: Array<{
      binding?: string;
      queue?: string;
    }>;
  };
}

function parseWranglerConfig(): WranglerConfig {
  const errors: ParseError[] = [];
  const config = parse(fs.readFileSync("wrangler.jsonc", "utf8"), errors, {
    allowTrailingComma: true,
  }) as WranglerConfig;

  if (errors.length > 0) {
    const message = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(", ");

    throw new Error(`Unable to parse wrangler.jsonc: ${message}`);
  }

  return config;
}

function getSchedulerQueueName(): string {
  const config = parseWranglerConfig();
  const queueName = config.queues?.producers
    ?.find((producer) => producer.binding === "SCHEDULER_QUEUE")
    ?.queue
    ?.trim();

  if (!queueName) {
    throw new Error("No Queue producer name was found in wrangler.jsonc.");
  }

  return queueName;
}

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
    vinext(),
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
