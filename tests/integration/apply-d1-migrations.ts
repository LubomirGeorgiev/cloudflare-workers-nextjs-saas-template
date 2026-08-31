/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";

const testEnv = env as Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

await applyD1Migrations(testEnv.D1_DB, testEnv.TEST_MIGRATIONS);
