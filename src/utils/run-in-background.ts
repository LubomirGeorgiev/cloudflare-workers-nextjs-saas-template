import "server-only";

import { waitUntil } from "cloudflare:workers";

export function runInBackground(promise: Promise<unknown>): void {
  const settled = promise.catch((error) => {
    console.error("Background update failed:", error);
  });

  try {
    waitUntil(settled);
  } catch {
    // No request context (queue consumer, scheduled handler, tests): the promise still settles.
  }
}
