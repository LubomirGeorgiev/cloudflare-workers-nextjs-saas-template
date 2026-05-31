import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  logLevel: "error",
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: "2026-04-21",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          APP_TEST_MODE: "true",
          EMAIL_FROM: "no-reply@example.com",
          EMAIL_FROM_NAME: "Integration Tests",
          EMAIL_REPLY_TO: "reply@example.com",
          TEST_MIGRATIONS: await readD1Migrations("src/db/migrations"),
        },
        d1Databases: {
          NEXT_TAG_CACHE_D1: {
            id: "credit-billing-integration-db",
          },
        },
        kvNamespaces: {
          NEXT_INC_CACHE_KV: {
            id: "credit-billing-integration-kv",
          },
        },
        queueProducers: {
          SCHEDULER_QUEUE: {
            queueName: "credit-billing-integration-scheduler",
          },
        },
      },
    })),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@paralleldrive/cuid2": fileURLToPath(new URL("./tests/integration/shims/cuid2.ts", import.meta.url)),
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    reporters: process.env.GITHUB_ACTIONS === "true" ? ["dot", "github-actions"] : ["default"],
    setupFiles: ["./tests/integration/apply-d1-migrations.ts"],
    testTimeout: 15_000,
  },
});
