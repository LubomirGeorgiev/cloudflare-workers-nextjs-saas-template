import "server-only";

import { drizzle } from "drizzle-orm/d1";
import { cache } from "react";
import { env as workerEnv } from "cloudflare:workers";

import { shouldLogD1Queries } from "./logging";
import { relations } from "./schema";
import * as schema from "./schema";

export const getDB = cache(() => {
  if (!workerEnv.NEXT_TAG_CACHE_D1) {
    throw new Error("D1 database not found");
  }

  return drizzle(workerEnv.NEXT_TAG_CACHE_D1, {
    schema,
    relations,
    logger: shouldLogD1Queries({ appTestMode: workerEnv.APP_TEST_MODE as string | undefined }),
  });
});
