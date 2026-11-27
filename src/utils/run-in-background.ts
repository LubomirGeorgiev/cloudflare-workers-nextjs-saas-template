import "server-only";

import { waitUntil } from "cloudflare:workers";

const FAILURE_MESSAGE = "Background task failed";

/**
 * Lets the request go on without `promise`. A rejection logs one structured line and never reaches
 * the caller. `operation` must be a fixed name, never user data.
 */
export function runInBackground({ operation, promise }: BackgroundTask): void {
  const settled = promise.catch((error: unknown) => {
    // The error text can carry user data, so the line names only the error class.
    console.error(JSON.stringify({
      message: FAILURE_MESSAGE,
      operation,
      errorName: error instanceof Error ? error.name : "unknown",
    }));
  });

  try {
    waitUntil(settled);
  } catch {
    // No request context (queue consumer, scheduled handler, tests): the promise still settles.
  }
}

interface BackgroundTask {
  operation: string;
  promise: Promise<unknown>;
}
