import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import { rejectNextRuntimeInternals, vinextTestAliases } from "./tests/vinext-test-runtime";

export default defineConfig({
  plugins: [rejectNextRuntimeInternals()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      ...vinextTestAliases,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    reporters: process.env.GITHUB_ACTIONS === "true" ? ["dot", "github-actions"] : ["default"],
  },
});
