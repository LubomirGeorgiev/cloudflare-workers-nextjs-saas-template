import { defineConfig } from "vitest/config";
import { getE2ERuntimeEnv } from "./tests/e2e/e2e-environment.mjs";
import { rejectNextRuntimeInternals, vinextTestAliases } from "./tests/vinext-test-runtime";

export default defineConfig({
  plugins: [rejectNextRuntimeInternals()],
  resolve: {
    alias: vinextTestAliases,
  },
  test: {
    env: getE2ERuntimeEnv(),
    globalSetup: ["./tests/e2e/global-setup.ts"],
    include: ["tests/e2e/**/*.test.ts"],
    hookTimeout: 180_000,
    testTimeout: 10_000,
    teardownTimeout: 10_000,
    fileParallelism: true,
    maxWorkers: 4,
    reporters: process.env.GITHUB_ACTIONS === "true" ? ["dot", "github-actions"] : ["verbose"],
  },
});
