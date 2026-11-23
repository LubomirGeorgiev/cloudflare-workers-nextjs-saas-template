import "server-only";

import { drizzle } from "drizzle-orm/d1";
import { cache } from "react";
import { env as workerEnv } from "cloudflare:workers";

import { relations } from "./schema";

// Every query runs inside a D1 session, so replicas can serve reads once read replication is on for
// the database (it is off by default; then both clients read the primary). `first-primary` sends
// the first query to the primary, so read-your-writes holds across requests (post -> redirect).
const PRIMARY_SESSION_CONSTRAINT = "first-primary" satisfies D1SessionConstraint;

// The first query may go to any replica, which can be a moment behind the primary. Only for reads
// that already tolerate old data. Set this to "first-primary" to stop all replica reads in one place.
const REPLICA_SESSION_CONSTRAINT = "first-unconstrained" satisfies D1SessionConstraint;

function createDrizzleClient(constraint: D1SessionConstraint) {
  if (!workerEnv.D1_DB) {
    throw new Error("D1 database not found");
  }

  return drizzle(workerEnv.D1_DB.withSession(constraint), {
    relations,
    logger: process.env.NODE_ENV === "development",
  });
}

// One session per request (React `cache` memoizes it), so all queries of one render are
// sequentially consistent with each other.
export const getDB = cache(() => createDrizzleClient(PRIMARY_SESSION_CONSTRAINT));

// Read client for data behind the KV cache. Never use it for a read that a write in the same
// request must see, and never for a read whose result the user expects immediately after an edit.
export const getReadReplicaDB = cache(() => createDrizzleClient(REPLICA_SESSION_CONSTRAINT));
