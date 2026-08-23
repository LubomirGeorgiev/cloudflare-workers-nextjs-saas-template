// Worker entry for edge-only behavior before vinext's App Router handles the request.
//
// Composition only: this file decides *what runs in what order*, never what any policy is. The
// OAuth-owned pieces (issuance and anonymous throttling, DCR mirroring, API-key token resolution)
// live in `src/lib/oauth/edge/`, are lazily imported, and are unit-testable without a Worker.
// Put every new edge concern in its own helper, never inline in `fetch`: `fetch` is at its
// complexity cap, and each helper stays readable and testable on its own.
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import handler from "vinext/server/fetch-handler";
import {
  API_OPENAPI_SPEC_METHODS,
  API_OPENAPI_SPEC_PATH,
  API_V1_BASE_PATH,
  MARKDOWN_CONTENT_TYPE,
  MARKDOWN_EXTENSION,
  MCP_PATH,
  OAUTH_ISSUANCE_THROTTLED_METHODS,
  OAUTH_REGISTER_PATH,
} from "./src/constants";
import {
  EDGE_CACHED_METADATA_ROUTE_TAGS,
  METADATA_ROUTE_EDGE_CACHE_CONTROL,
} from "./src/constants/cache-control";
import { oauthCoreOptions } from "./src/lib/oauth/provider-config";
import type { ScheduledQueueMessage } from "./src/lib/scheduler/jobs";
import { looksLikeApiKey } from "./src/utils/api-key-format";
import { __INTERNAL_CF_CONTEXT_FIELDS, encodeCfHeaderValue } from "./src/utils/cf-context-fields";
import {
  __INTERNAL_CLIENT_IP_HEADERS_TO_STRIP,
  __INTERNAL_TRUSTED_CLIENT_IP_HEADER,
} from "./src/utils/trusted-client-ip";
import { __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER } from "./src/utils/request-protocol";

const OPENAPI_SPEC_METHODS: ReadonlySet<string> = new Set(API_OPENAPI_SPEC_METHODS);

function handleCustomEdge(pathname: string): Response | null {
  if (pathname === "/_worker/health") {
    return Response.json({ ok: true });
  }

  return null;
}

// The OpenAPI document is deliberately readable without a credential (it is what agent clients and
// the docs UI discover the API with), and the provider rejects every credential-less `apiHandlers`
// request — so only the methods the canonical route serves skip it; the rest fall through to it.
function isOpenApiSpecRequest({ method, pathname }: { method: string; pathname: string }): boolean {
  return pathname === API_OPENAPI_SPEC_PATH && OPENAPI_SPEC_METHODS.has(method);
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

// Reaching the document through `apiHandler` would build the whole Hono app — every router and the
// services behind them, Stripe included — to serve prebuilt bytes. The app keeps its own
// `/openapi.json` route for when it is mounted directly; both answer with the same producer.
const openapiHandler = {
  fetch: async (): Promise<Response> =>
    (await import("./src/api/generated-document")).apiDocumentResponse(),
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

async function handleEarlyEdgeRequest({
  method,
  pathname,
}: {
  method: string;
  pathname: string;
}): Promise<Response | null> {
  const customResponse = handleCustomEdge(pathname);
  if (customResponse) {
    return customResponse;
  }

  // Called ahead of the header clone: the document is prebuilt bytes that depend on nothing in the
  // request, so normalizing headers for it would be pure waste.
  if (isOpenApiSpecRequest({ method, pathname })) {
    return openapiHandler.fetch();
  }

  return null;
}

// Both ways to ask for Markdown, in the order they must be tried. The negotiated redirect is the
// `else` branch, so a `.md` URL is never negotiated against itself, and it answers at the edge
// rather than rendering: an agent that asked for Markdown must not pay for an HTML render first.
async function handleMarkdownEdgeRequest({
  request,
  env,
  ctx,
  pathname,
}: {
  ctx: ExecutionContext;
  env: Env;
  pathname: string;
  request: Request;
}): Promise<Response | null> {
  const method = request.method;
  if (method !== "GET" && method !== "HEAD") {
    return null;
  }

  if (pathname.toLowerCase().endsWith(MARKDOWN_EXTENSION)) {
    return (await import("./src/lib/markdown-pages")).handleMarkdownRequest({
      request,
      env,
      ctx,
      render: nextAppHandler.fetch,
    });
  }

  // Cheap prefilter, deliberately broader than the real rule: it runs on every page request, and
  // the exact parse stays behind the `import()` with the rest of the Markdown graph.
  const accept = request.headers.get("accept");
  if (accept === null || !accept.toLowerCase().includes(MARKDOWN_CONTENT_TYPE)) {
    return null;
  }

  return (await import("./src/lib/markdown-pages/accept-negotiation"))
    .markdownNegotiationRedirect({ accept, pathname });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    const earlyResponse = await handleEarlyEdgeRequest({ method: request.method, pathname });
    if (earlyResponse) {
      return earlyResponse;
    }

    // Header normalization applies to every branch below — including everything behind the OAuth
    // provider — so the API sees the same trusted client IP and Cloudflare context the Next app does.
    const forwarded = withForwardedCfHeaders({ request, url });

    const markdownResponse = await handleMarkdownEdgeRequest({
      request: forwarded,
      env,
      ctx,
      pathname,
    });
    if (markdownResponse) {
      return markdownResponse;
    }

    // The gate enforces this same set; reading it here too is what keeps the KV limiter off the
    // graph for the GET traffic that is nearly all of it. One constant, so they cannot diverge.
    if (OAUTH_ISSUANCE_THROTTLED_METHODS.includes(request.method)) {
      const throttled = await (await getThrottleGates())
        .getIssuanceThrottleResponse({ request: forwarded, pathname });
      if (throttled) {
        return throttled;
      }
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

    const withDiscovery = await withHtmlAgentDiscovery({
      method: request.method,
      pathname,
      response,
    });

    return withMetadataRouteEdgeCache({ method: request.method, pathname, response: withDiscovery });
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

async function withHtmlAgentDiscovery({
  method,
  pathname,
  response,
}: {
  method: string;
  pathname: string;
  response: Response;
}): Promise<Response> {
  const contentType = response.headers.get("content-type");

  if ((method !== "GET" && method !== "HEAD") || !contentType?.startsWith("text/html")) {
    return response;
  }

  return (await import("./src/lib/markdown-pages/discovery-links")).withHtmlDiscoveryLinkHeader({
    pathname,
    response,
  });
}

// Re-wraps rather than mutating in place: a response is free to carry immutable headers, and
// re-wrapping re-points the body stream rather than reading it.
function withMetadataRouteEdgeCache(
  { method, pathname, response }: { method: string; pathname: string; response: Response },
): Response {
  const cacheTag = Object.hasOwn(EDGE_CACHED_METADATA_ROUTE_TAGS, pathname)
    ? EDGE_CACHED_METADATA_ROUTE_TAGS[pathname]
    : undefined;

  if (cacheTag === undefined || !response.ok || (method !== "GET" && method !== "HEAD")) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("cdn-cache-control", METADATA_ROUTE_EDGE_CACHE_CONTROL);

  if (cacheTag) {
    headers.set("cache-tag", cacheTag);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

// Only set here (never trusted from the inbound request) to prevent client spoofing. Takes the
// already-parsed URL: the caller has one, and parsing is not free on a per-request path.
function withForwardedCfHeaders({ request, url }: { request: Request; url: URL }): Request {
  const forwarded = new Request(request);
  forwarded.headers.delete(__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER);
  forwarded.headers.set(
    __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER,
    url.protocol.slice(0, -1),
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
      forwarded.headers.set(header, encodeCfHeaderValue(String(value)));
    }
  }

  return forwarded;
}

export default worker;
