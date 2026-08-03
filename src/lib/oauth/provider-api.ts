import "server-only";

import { getOAuthApi, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { env } from "cloudflare:workers";

import { oauthCoreOptions } from "@/lib/oauth/provider-config";

// The library also assigns `env.OAUTH_PROVIDER` on the env object it hands to the wrapped
// handlers, but Next server code reads env through `cloudflare:workers` — a different reference.
// Building the helpers ourselves works identically in pages, actions, the queue, and the cron.
// The library validates a full routing configuration even for helpers that never route a request,
// so the handlers here exist only to satisfy that constructor check.
const NOOP_HANDLER = { fetch: () => new Response(null, { status: 404 }) };

export function getOAuthHelpers(): OAuthHelpers {
  return getOAuthApi<Env>(
    {
      ...oauthCoreOptions,
      defaultHandler: NOOP_HANDLER,
      apiRoute: [],
      apiHandler: NOOP_HANDLER,
    },
    env,
  );
}
