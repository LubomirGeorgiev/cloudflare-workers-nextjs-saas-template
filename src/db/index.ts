import "server-only";

import { drizzle } from "drizzle-orm/d1";
import { cache } from "react";
import { env as workerEnv } from "cloudflare:workers";

import { relations } from "./schema";

export const getDB = cache(() => {
  if (!workerEnv.D1_DB) {
    throw new Error("D1 database not found");
  }

  return drizzle(workerEnv.D1_DB, {
    relations,
    logger: process.env.NODE_ENV === "development",
  });
});
