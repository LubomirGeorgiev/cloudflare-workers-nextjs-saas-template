import "server-only";
import type Stripe from "stripe";

import { lazyValue } from "@/utils/lazy-value";

// `import()`ed, never static: the Hono app mounts the billing router at module scope, so a static
// import puts ~211 KiB of Stripe on the graph of every API and MCP request, billing or not.

// The client survives reuse across requests because fetch transport holds no socket, unlike a
// Hyperdrive/`pg` connection, which must be built per request; see `lazyValue` for the contract.
// A missing key rejects rather than caching a broken client, so a late-bound env still works.
export const getStripe = lazyValue(async (): Promise<Stripe> => {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeSecretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY environment variable");
  }

  const { default: StripeSdk } = await import("stripe");

  return new StripeSdk(stripeSecretKey, {
    apiVersion: "2026-07-29.dahlia",
    typescript: true,
    httpClient: StripeSdk.createFetchHttpClient()
  });
});
