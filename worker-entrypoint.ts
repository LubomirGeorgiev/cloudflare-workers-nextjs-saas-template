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
  API_CATALOG_METHODS,
  API_CATALOG_PATH,
  API_OPENAPI_SPEC_METHODS,
  API_OPENAPI_SPEC_PATH,
  API_V1_BASE_PATH,
  ADMIN_API_BASE_PATH,
  ADMIN_MCP_PATH,
  HTML_CONTENT_TYPE,
  IMAGE_OPTIMIZATION_PATH,
  MARKDOWN_CONTENT_TYPE,
  MARKDOWN_EXTENSION,
  MCP_PATH,
  OAUTH_ISSUANCE_THROTTLED_METHODS,
  OAUTH_PROTECTED_RESOURCE_PATH,
  OAUTH_REGISTER_PATH,
} from "./src/constants";
import {
  EDGE_CACHED_METADATA_ROUTE_TAGS,
  METADATA_ROUTE_EDGE_CACHE_CONTROL,
} from "./src/constants/cache-control";
import { I18N_ENABLED } from "./src/constants";
import { stripLocalePrefix } from "./src/i18n/locale-prefix";
import { shouldLocalizePathname } from "./src/i18n/localized-paths";
import { ADMIN_SCOPE_NAMES } from "./src/lib/api/admin-scopes";
import { isCmsImageSource } from "./src/utils/cms-image-source";
import { isOgImageRequest } from "./src/lib/og/og-paths";
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
const CATALOG_METHODS: ReadonlySet<string> = new Set(API_CATALOG_METHODS);

function handleCustomEdge(pathname: string): Response | null {
  if (pathname === "/_worker/health") {
    return Response.json({ ok: true });
  }

  return null;
}

// With i18n disabled, locale-prefixed URLs collapse to one canonical bare path. Decided from the
// URL alone, so it answers here rather than in `src/proxy.ts`. 307 so indexed and bookmarked
// prefixes keep working without caching a permanent mapping if i18n is re-enabled.
function collapseDisabledLocalePrefix(url: URL): Response | null {
  if (I18N_ENABLED || !shouldLocalizePathname(url.pathname)) {
    return null;
  }

  const stripped = stripLocalePrefix(url.pathname);
  if (stripped === null) {
    return null;
  }

  const target = new URL(url);
  target.pathname = stripped;

  return Response.redirect(target.toString(), 307);
}

// An OG card is a public image whose locale is already in its path, so the locale cookie next-intl
// sets buys it nothing — and Workers Caching bypasses any response carrying Set-Cookie. Social
// crawlers never send cookies back, so without this every crawl re-renders (satori + resvg). Safe
// as a blanket delete only because no other cookie is set on these routes, and because a page URL
// shaped like a card (`/blog/opengraph-image-launch`) is excluded by the request itself.
function withoutOgCardCookie({
  headers,
  pathname,
  response,
}: {
  headers: Headers;
  pathname: string;
  response: Response;
}): Response {
  if (!response.headers.has("set-cookie") || !isOgImageRequest({ pathname, headers })) {
    return response;
  }

  const stripped = new Headers(response.headers);
  stripped.delete("set-cookie");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: stripped,
  });
}

// The OpenAPI document is deliberately readable without a credential (it is what agent clients and
// the docs UI discover the API with), and the provider rejects every credential-less `apiHandlers`
// request — so only the methods the canonical route serves skip it; the rest fall through to it.
function isOpenApiSpecRequest({ method, pathname }: { method: string; pathname: string }): boolean {
  return pathname === API_OPENAPI_SPEC_PATH && OPENAPI_SPEC_METHODS.has(method);
}

// RFC 9727. Nothing else claims this path — the OAuth provider serves only its own two
// `.well-known` documents — so the safe methods answer here and every other method falls through
// to the app's 404.
function isApiCatalogRequest({ method, pathname }: { method: string; pathname: string }): boolean {
  return pathname === API_CATALOG_PATH && CATALOG_METHODS.has(method);
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

// Lazy for the same reason, and cheap for the same one: the catalog is a fixed string built from
// constants, so only a request that asks for it evaluates the module that holds it.
const apiCatalogHandler = {
  fetch: async (): Promise<Response> =>
    (await import("./src/lib/api/api-catalog")).apiCatalogResponse(),
};

// The internal surfaces, lazy for the same reasons as their public twins. They are mounted on the
// same provider funnel deliberately: an admin API key is resolved by `resolveExternalToken` exactly
// as any other key is, so there is one credential path, not a second one to keep in step.
const adminApiHandler = {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> =>
    (await import("./src/api/admin")).adminApiApp.fetch(request, env, ctx),
};

const adminMcpHandler = {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> =>
    (await import("./src/mcp/admin")).adminMcpApiHandler.fetch(request, env, ctx),
};

// The internal routes are their own map, and the full table below spreads it: the challenge and
// metadata helpers name this map, so the internal surface is stated once, not twice.
const internalApiHandlers = {
  [`${ADMIN_API_BASE_PATH}/`]: adminApiHandler,
  [ADMIN_MCP_PATH]: adminMcpHandler,
};

// Trailing slash is significant: the library prefix-matches API routes. `/mcp` is an exact
// endpoint, so it needs none, and both credential types reach it through this same funnel.
//
// `/mcp/admin` is listed ahead of `/mcp` for readability only — `/mcp` has no trailing slash, so it
// matches exactly and can never swallow the admin path.
const apiHandlers = {
  ...internalApiHandlers,
  [`${API_V1_BASE_PATH}/`]: apiHandler,
  [MCP_PATH]: mcpHandler,
};

// Read once at module scope rather than per request: the tables are fixed, and both matchers run on
// the response path of every API request.
const PROVIDER_API_ROUTES = Object.keys(apiHandlers);
const INTERNAL_API_ROUTES = Object.keys(internalApiHandlers);

function matchesApiRoute({ routes, pathname }: { routes: string[]; pathname: string }): boolean {
  return routes.some((route) =>
    route.endsWith("/") ? pathname.startsWith(route) : pathname === route,
  );
}

// Derived from the routes above rather than restated, so the throttling below always covers
// exactly the surface the provider claims.
function isProviderApiPath(pathname: string): boolean {
  return matchesApiRoute({ routes: PROVIDER_API_ROUTES, pathname });
}

// ---------------------------------------------------------------------------
// The internal surfaces are discoverable like any other protected resource, but they advertise the
// *internal* catalog rather than the public one.
//
// The provider's own challenge names `API_SCOPE_NAMES`, so a client reading it would request the
// public scopes and receive a token that `assertAdminPrincipal` refuses forever. These two helpers
// replace that with the truth for these paths: ask for `admin:*`. A grant is still only issued to
// a live admin consenting to a verified client — `clampAdminScopesForConsent` owns that rule.
// ---------------------------------------------------------------------------
function isInternalApiPath(pathname: string): boolean {
  return matchesApiRoute({ routes: INTERNAL_API_ROUTES, pathname });
}

/** RFC 9728 §3.1 puts the resource path after the well-known prefix, so strip it back off. */
function internalResourceMetadataPath(pathname: string): string | null {
  if (!pathname.startsWith(`${OAUTH_PROTECTED_RESOURCE_PATH}/`)) {
    return null;
  }

  const resourcePath = pathname.slice(OAUTH_PROTECTED_RESOURCE_PATH.length);

  return isInternalApiPath(resourcePath) ? resourcePath : null;
}

// Built here rather than lazily imported: it is a handful of constants, and the module that holds
// the scope names is `server-only` and already on this graph.
function internalResourceMetadata(resourcePath: string, origin: string): Response {
  return Response.json({
    resource: `${origin}${resourcePath}`,
    authorization_servers: [origin],
    scopes_supported: [...ADMIN_SCOPE_NAMES],
    bearer_methods_supported: ["header"],
  });
}

// Headers on a provider response are immutable, so the challenge is swapped onto a copy.
function withInternalBearerChallenge({
  response,
  origin,
  pathname,
}: {
  response: Response;
  origin: string;
  pathname: string;
}): Response {
  const headers = new Headers(response.headers);
  headers.set(
    "www-authenticate",
    `Bearer realm="OAuth", resource_metadata="${origin}${OAUTH_PROTECTED_RESOURCE_PATH}${pathname}", scope="${ADMIN_SCOPE_NAMES.join(" ")}"`,
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
  url,
}: {
  method: string;
  url: URL;
}): Promise<Response | null> {
  const { origin, pathname } = url;

  const customResponse = handleCustomEdge(pathname) ?? collapseDisabledLocalePrefix(url);
  if (customResponse) {
    return customResponse;
  }

  // Called ahead of the header clone: the document is prebuilt bytes that depend on nothing in the
  // request, so normalizing headers for it would be pure waste.
  if (isOpenApiSpecRequest({ method, pathname })) {
    return openapiHandler.fetch();
  }

  // Same reasoning: the catalog names the APIs and depends on nothing in the request.
  if (isApiCatalogRequest({ method, pathname })) {
    return apiCatalogHandler.fetch();
  }

  // Answered here so the provider never does: its document would advertise the public catalog for
  // an endpoint that only accepts the internal one.
  const internalResourcePath = internalResourceMetadataPath(pathname);
  if (internalResourcePath) {
    return internalResourceMetadata(internalResourcePath, origin);
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

async function fetchAppRequest({ request, url, env, ctx }: {
  request: Request;
  url: URL;
  env: Env;
  ctx: ExecutionContext;
}): Promise<Response> {
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    url.pathname === IMAGE_OPTIMIZATION_PATH &&
    isCmsImageSource({ source: url.searchParams.get("url"), base: url })
  ) {
    // The default optimizer reads ASSETS, while CMS images live behind the R2 route.
    const { optimizeCmsImage } = await import("./src/lib/cms/optimize-cms-image");
    return optimizeCmsImage({
      request,
      images: env.IMAGES,
      fetchSource: (source) => oauthProvider.fetch(source, env, ctx),
    });
  }
  return oauthProvider.fetch(request, env, ctx);
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    const earlyResponse = await handleEarlyEdgeRequest({ method: request.method, url });
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
    // validation for `apiHandlers`; everything else falls through to the Next app.
    const response = await fetchAppRequest({ request: forwarded, url, env, ctx });

    if (response.status === 401 && isProviderApiPath(pathname)) {
      const challenged = isInternalApiPath(pathname)
        ? withInternalBearerChallenge({ response, origin: url.origin, pathname })
        : response;

      return (await getThrottleGates())
        .getAnonThrottleResponse({ request: forwarded, response: challenged });
    }

    if (request.method === "POST" && response.status === 201 && pathname === OAUTH_REGISTER_PATH) {
      (await import("./src/lib/oauth/edge/dcr-mirror"))
        .mirrorDcrRegistrationResponse({ response, ctx });
    }

    const withDiscovery = await withHtmlAgentDiscovery({
      method: request.method,
      pathname,
      response: withoutOgCardCookie({ headers: request.headers, pathname, response }),
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

  if ((method !== "GET" && method !== "HEAD") || !contentType?.startsWith(HTML_CONTENT_TYPE)) {
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
