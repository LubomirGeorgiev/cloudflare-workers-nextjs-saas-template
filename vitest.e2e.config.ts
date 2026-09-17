import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import {
  getE2EMaxWorkers,
  getE2ERuntimeEnv,
  scaleE2ETimeout,
} from "./tests/e2e/e2e-environment.mjs";
import { rejectNextRuntimeInternals, vinextTestAliases } from "./tests/vinext-test-runtime.ts";

export default defineConfig({
  plugins: [rejectNextRuntimeInternals()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      ...vinextTestAliases,
    },
  },
  test: {
    env: getE2ERuntimeEnv(),
    globalSetup: ["./tests/e2e/global-setup.ts"],
    include: ["tests/e2e/**/*.test.ts"],
    hookTimeout: 180_000,
    testTimeout: scaleE2ETimeout(10_000),
    teardownTimeout: 10_000,
    fileParallelism: true,
    maxWorkers: getE2EMaxWorkers(),
    reporters: process.env.GITHUB_ACTIONS === "true" ? ["dot", "github-actions"] : ["verbose"],
  },
});
