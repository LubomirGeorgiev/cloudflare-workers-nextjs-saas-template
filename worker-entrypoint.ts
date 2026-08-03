// Worker entry for edge-only behavior before vinext's App Router handles the request.
//
// Composition only: this file decides *what runs in what order*, never what any policy is. The
// OAuth-owned pieces (issuance and anonymous throttling, DCR mirroring, API-key token resolution)
// live in `src/lib/oauth/edge/`, are lazily imported, and are unit-testable without a Worker.
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import handler from "vinext/server/fetch-handler";
import {
  API_OPENAPI_SPEC_PATH,
  API_V1_BASE_PATH,
  MCP_PATH,
  OAUTH_REGISTER_PATH,
} from "./src/constants";
import { oauthCoreOptions } from "./src/lib/oauth/provider-config";
import type { ScheduledQueueMessage } from "./src/lib/scheduler/jobs";
import { looksLikeApiKey } from "./src/utils/api-key-format";
import { __INTERNAL_CF_CONTEXT_FIELDS } from "./src/utils/cf-context-fields";
import {
  __INTERNAL_CLIENT_IP_HEADERS_TO_STRIP,
  __INTERNAL_TRUSTED_CLIENT_IP_HEADER,
} from "./src/utils/trusted-client-ip";
import { __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER } from "./src/utils/request-protocol";

function handleCustomEdge(pathname: string): Response | null {
  if (pathname === "/_worker/health") {
    return Response.json({ ok: true });
  }

  return null;
}

// The OpenAPI document is deliberately readable without a credential (it is what agent clients
// and the docs UI discover the API with). The provider rejects every `apiHandlers` request that
// arrives without a bearer token, so this one path is routed to the Hono app ahead of it.
function isUnauthenticatedApiPath(pathname: string): boolean {
  return pathname === API_OPENAPI_SPEC_PATH;
}

// Everything the provider does not claim: the whole Next app, including our own consent page at
// /oauth/authorize. Kept as an ExportedHandler so the provider can call it directly.
const nextAppHandler = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => handler.fetch(request, env, ctx),
};

// Imported on first use, never at startup: the MCP SDK builds its whole protocol schema set at
// import time, and no other route should pay for that on a cold isolate.
const mcpHandler = {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> =>
    (await import("./src/mcp")).mcpApiHandler.fetch(request, env, ctx),
};

// Same reason: the Hono app statically reaches the whole service layer, including Stripe billing.
// A page request must not evaluate any of it, so the API is a lazy handler too.
const apiHandler = {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> =>
    (await import("./src/api")).apiApp.fetch(request, env, ctx),
};

// Trailing slash is significant: the library prefix-matches API routes. `/mcp` is an exact
// endpoint, so it needs none, and both credential types reach it through this same funnel.
const apiHandlers = { [`${API_V1_BASE_PATH}/`]: apiHandler, [MCP_PATH]: mcpHandler };

// Derived from the routes above rather than restated, so the throttling below always covers
// exactly the surface the provider claims.
function isProviderApiPath(pathname: string): boolean {
  return Object.keys(apiHandlers).some((route) =>
    route.endsWith("/") ? pathname.startsWith(route) : pathname === route,
  );
}

const oauthProvider = new OAuthProvider<Env>({
  ...oauthCoreOptions,
  apiHandlers,
  defaultHandler: nextAppHandler,
  // Imported here rather than at startup: the KV/D1 lookup chain is only reachable by a request
  // that actually carries an API key, which no page request does.
  resolveExternalToken: async ({ token }) => {
    if (!looksLikeApiKey(token)) {
      return null;
    }

    return (await import("./src/lib/oauth/edge/external-token")).resolveApiKeyToken(token);
  },
});

// Lazy for the same reason as the handlers: only a request that reaches OAuth or the API pays for
// the KV limiter, never a page request.
async function getThrottleGates() {
  return import("./src/lib/oauth/edge/throttle-gates");
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    const early = handleCustomEdge(pathname);
    if (early) {
      return early;
    }

    // Header normalization applies to every branch — including everything behind the OAuth
    // provider — so the API sees the same trusted client IP and Cloudflare context the Next app does.
    const forwarded = withForwardedCfHeaders(request);

    if (isUnauthenticatedApiPath(pathname)) {
      return apiHandler.fetch(forwarded, env, ctx);
    }

    const throttled = await (await getThrottleGates())
      .getIssuanceThrottleResponse({ request: forwarded, pathname });
    if (throttled) {
      return throttled;
    }

    // The provider owns /oauth/token, /oauth/register, both discovery documents, and bearer
    // validation for `apiHandlers`; everything else falls through to the Next app. `/_next/image`
    // optimization is handled inside the wrapped fetch-handler via the Cloudflare Images adapter.
    const response = await oauthProvider.fetch(forwarded, env, ctx);

    if (response.status === 401 && isProviderApiPath(pathname)) {
      return (await getThrottleGates()).getAnonThrottleResponse({ request: forwarded, response });
    }

    if (request.method === "POST" && response.status === 201 && pathname === OAUTH_REGISTER_PATH) {
      (await import("./src/lib/oauth/edge/dcr-mirror"))
        .mirrorDcrRegistrationResponse({ response, ctx });
    }

    return response;
  },

  // Cron and queue are their own entrypoints, so the job graph is imported on the invocation that
  // needs it rather than on every cold isolate serving requests.
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const { handleSchedulerCron } = await import("./src/lib/scheduler/worker");

    ctx.waitUntil(handleSchedulerCron({
      env,
      now: new Date(controller.scheduledTime),
    }));
  },

  async queue(batch: MessageBatch<ScheduledQueueMessage>, __env: Env, __ctx: ExecutionContext): Promise<void> {
    const { handleSchedulerQueue } = await import("./src/lib/scheduler/worker");

    await handleSchedulerQueue(batch);
  },
} satisfies ExportedHandler<Env, ScheduledQueueMessage>;

// Only set here (never trusted from the inbound request) to prevent client spoofing.
function withForwardedCfHeaders(request: Request): Request {
  const forwarded = new Request(request);
  forwarded.headers.delete(__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER);
  forwarded.headers.set(
    __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER,
    new URL(request.url).protocol.slice(0, -1),
  );

  for (const header of __INTERNAL_CLIENT_IP_HEADERS_TO_STRIP) {
    forwarded.headers.delete(header);
  }

  for (const { header } of __INTERNAL_CF_CONTEXT_FIELDS) {
    forwarded.headers.delete(header);
  }

  const trustedClientIp = request.headers.get("cf-connecting-ip");
  if (trustedClientIp) {
    forwarded.headers.set(__INTERNAL_TRUSTED_CLIENT_IP_HEADER, trustedClientIp);
  }

  const cf = request.cf;
  if (!cf) {
    return forwarded;
  }

  for (const { key, header } of __INTERNAL_CF_CONTEXT_FIELDS) {
    const value = cf[key];
    if (value !== undefined && value !== null && value !== "") {
      forwarded.headers.set(header, String(value));
    }
  }

  return forwarded;
}

export default worker;
