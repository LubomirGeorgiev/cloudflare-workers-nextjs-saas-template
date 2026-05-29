/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";

const testEnv = env as Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

await applyD1Migrations(testEnv.NEXT_TAG_CACHE_D1, testEnv.TEST_MIGRATIONS);
