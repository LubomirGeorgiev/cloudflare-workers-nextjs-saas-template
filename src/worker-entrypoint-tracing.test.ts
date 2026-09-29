import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  ADMIN_API_BASE_PATH,
  ADMIN_MCP_PATH,
  API_V1_BASE_PATH,
  MCP_PATH,
  OAUTH_TOKEN_PATH,
} from "@/constants";
import { EDGE_HTML_CACHE_HEADER, EDGE_HTML_CACHE_STATUS } from "@/constants/edge-html-cache";

const {
  enteredSpans,
  fakeSpan,
  innerFetchMock,
  readEdgeHtmlPageMock,
  resolveEdgeHtmlCacheEntryMock,
  spanAttributes,
} = vi.hoisted(() => {
  const attributes = new Map<string, unknown>();
  const span = {
    isTraced: true,
    recordException: vi.fn(),
    setAttribute: vi.fn((key: string, value: unknown) => {
      attributes.set(key, value);

      return span;
    }),
    setAttributes: vi.fn((values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) {
        attributes.set(key, value);
      }

      return span;
    }),
  };

  return {
    enteredSpans: [] as string[],
    fakeSpan: span,
    innerFetchMock: vi.fn(),
    readEdgeHtmlPageMock: vi.fn(),
    resolveEdgeHtmlCacheEntryMock: vi.fn(),
    spanAttributes: attributes,
  };
});

vi.mock("server-only", () => ({}));

// Pass-through, like the runtime: the callback runs at once and its result is the span's result.
vi.mock("cloudflare:workers", () => ({
  tracing: {
    enterSpan: (name: string, callback: (span: unknown, ...args: unknown[]) => unknown, ...args: unknown[]) => {
      enteredSpans.push(name);

      return callback(fakeSpan, ...args);
    },
  },
}));

vi.mock("vinext/server/fetch-handler", () => ({
  default: { fetch: innerFetchMock },
}));

// The real provider needs the Workers runtime. Every request here falls through to the app.
vi.mock("@cloudflare/workers-oauth-provider", () => ({
  OAuthProvider: vi.fn(function oauthProvider(options: {
    defaultHandler: { fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> };
  }) {
    return {
      fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
        options.defaultHandler.fetch(request, env, ctx),
    };
  }),
}));

vi.mock("@/lib/edge/edge-html-cache", () => ({
  readEdgeHtmlPage: readEdgeHtmlPageMock,
  resolveEdgeHtmlCacheEntry: resolveEdgeHtmlCacheEntryMock,
  storeEdgeHtmlPage: ({ response }: { response: Response }) => response,
}));

const { default: worker } = await import("../worker-entrypoint");

const REQUEST_SPAN_NAME = "app.request";
const EDGE_HTML_CACHE_LOOKUP_SPAN_NAME = "app.edge_html_cache.lookup";
const ROUTE_KIND_ATTRIBUTE = "app.route.kind";

describe("worker request span", () => {
  beforeEach(() => {
    resolveEdgeHtmlCacheEntryMock.mockReturnValue(null);
  });

  afterEach(() => {
    enteredSpans.length = 0;
    spanAttributes.clear();
    vi.clearAllMocks();
  });

  test.each([
    ["page", "/"],
    ["api", `${API_V1_BASE_PATH}/teams`],
    ["mcp", MCP_PATH],
    ["admin_api", `${ADMIN_API_BASE_PATH}/users`],
    ["admin_mcp", ADMIN_MCP_PATH],
    ["oauth", OAUTH_TOKEN_PATH],
  ])("returns the app response unchanged and tags the %s route kind", async (kind, pathname) => {
    const appResponse = new Response("ok", { status: 202 });
    innerFetchMock.mockResolvedValue(appResponse);

    const response = await fetchPath(pathname);

    expect(response).toBe(appResponse);
    expect(enteredSpans[0]).toBe(REQUEST_SPAN_NAME);
    expect(spanAttributes.get(ROUTE_KIND_ATTRIBUTE)).toBe(kind);
    expect(spanAttributes.get("http.request.method")).toBe("GET");
    expect(spanAttributes.get("http.response.status_code")).toBe(appResponse.status);
  });

  test("tags an edge short-circuit without calling the app", async () => {
    const response = await fetchPath("/_worker/health");

    expect(response.ok).toBe(true);
    expect(innerFetchMock).not.toHaveBeenCalled();
    expect(spanAttributes.get(ROUTE_KIND_ATTRIBUTE)).toBe("edge");
  });

  test("puts the edge HTML cache lookup in a child span and records a hit", async () => {
    resolveEdgeHtmlCacheEntryMock.mockReturnValue({});
    readEdgeHtmlPageMock.mockResolvedValue(
      new Response("<p>stored</p>", { headers: { "content-type": "text/html; charset=utf-8" } }),
    );

    const response = await fetchPath("/");

    expect(response.headers.get(EDGE_HTML_CACHE_HEADER)).toBe(EDGE_HTML_CACHE_STATUS.HIT);
    expect(innerFetchMock).not.toHaveBeenCalled();
    expect(enteredSpans).toEqual([REQUEST_SPAN_NAME, EDGE_HTML_CACHE_LOOKUP_SPAN_NAME]);
    expect(spanAttributes.get("app.edge_html_cache")).toBe(EDGE_HTML_CACHE_STATUS.HIT);
  });

  test("records the exception and rethrows it", async () => {
    const failure = new Error("render failed");
    innerFetchMock.mockRejectedValue(failure);

    await expect(fetchPath(`${API_V1_BASE_PATH}/teams`)).rejects.toBe(failure);
    expect(fakeSpan.recordException).toHaveBeenCalledWith(
      expect.objectContaining({ name: failure.name, message: failure.message }),
    );
  });
});

function fetchPath(pathname: string): Promise<Response> {
  return worker.fetch(
    new Request(`https://example.com${pathname}`),
    {} as Env,
    { props: {}, waitUntil: () => undefined } as unknown as ExecutionContext,
  );
}
