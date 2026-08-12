import "server-only";

import { drizzle } from "drizzle-orm/d1";
import { cache } from "react";
import { env as workerEnv } from "cloudflare:workers";

import { relations } from "./schema";

export const getDB = cache(() => {
  if (!workerEnv.NEXT_TAG_CACHE_D1) {
    throw new Error("D1 database not found");
  }

  return drizzle(workerEnv.NEXT_TAG_CACHE_D1, {
    relations,
    logger: process.env.NODE_ENV === "development",
  });
});
