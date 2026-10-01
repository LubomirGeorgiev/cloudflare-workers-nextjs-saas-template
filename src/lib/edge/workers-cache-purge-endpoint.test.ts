import { afterEach, describe, expect, test, vi } from "vitest";

const { purgeInRequestContextMock } = vi.hoisted(() => ({
  purgeInRequestContextMock: vi.fn(async (__input: { tags: readonly string[] }) => "ok"),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/edge/workers-cache-purge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/edge/workers-cache-purge")>(
    "@/lib/edge/workers-cache-purge",
  );

  return {
    WORKERS_CACHE_PURGE_OUTCOME: actual.WORKERS_CACHE_PURGE_OUTCOME,
    purgeWorkersCacheTagsInRequestContext: purgeInRequestContextMock,
  };
});

const { CACHE_TAG_MAX_LENGTH, SITE_URL, WORKERS_CACHE_PURGE_MAX_TAGS, WORKERS_CACHE_PURGE_PATH } =
  await import("@/constants");
const { CACHE_TAGS } = await import("@/constants/cache-tags");
const { WORKERS_CACHE_PURGE_OUTCOME } = await import("@/lib/edge/workers-cache-purge");
const { handleWorkersCachePurgeRequest } = await import(
  "@/lib/edge/workers-cache-purge-endpoint"
);

const TAGS = [CACHE_TAGS.SITEMAP, CACHE_TAGS.CMS_TAGS];

function purgeRequest({
  body = { tags: TAGS },
  method = "POST",
}: {
  body?: unknown;
  method?: string;
} = {}): Request {
  return new Request(new URL(WORKERS_CACHE_PURGE_PATH, SITE_URL), {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("the Workers Caching purge route", () => {
  test("it purges the tags of a valid request and is never stored", async () => {
    const response = await handleWorkersCachePurgeRequest({ request: purgeRequest() });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(purgeInRequestContextMock).toHaveBeenCalledWith({ tags: TAGS });
  });

  test("a method other than POST is refused", async () => {
    const response = await handleWorkersCachePurgeRequest({
      request: purgeRequest({ method: "GET" }),
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(purgeInRequestContextMock).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: "too many tags",
      body: { tags: Array.from({ length: WORKERS_CACHE_PURGE_MAX_TAGS + 1 }, (_, index) => `t${index}`) },
    },
    { name: "a tag over the length limit", body: { tags: ["t".repeat(CACHE_TAG_MAX_LENGTH + 1)] } },
    { name: "no tags", body: { tags: [] } },
    { name: "an empty tag", body: { tags: [""] } },
    { name: "an unknown field", body: { tags: TAGS, purgeEverything: true } },
    { name: "a body that is not JSON", body: "{tags:" },
  ])("$name is refused with 400", async ({ body }) => {
    const response = await handleWorkersCachePurgeRequest({
      request: purgeRequest({ body }),
    });

    expect(response.status).toBe(400);
    expect(purgeInRequestContextMock).not.toHaveBeenCalled();
  });

  test.each([
    { outcome: WORKERS_CACHE_PURGE_OUTCOME.SKIPPED_UNAVAILABLE, status: 503 },
    { outcome: WORKERS_CACHE_PURGE_OUTCOME.FAILED, status: 502 },
  ])("a purge that ends $outcome answers $status", async ({ outcome, status }) => {
    purgeInRequestContextMock.mockResolvedValueOnce(outcome);

    const response = await handleWorkersCachePurgeRequest({ request: purgeRequest() });

    expect(response.status).toBe(status);
  });
});
