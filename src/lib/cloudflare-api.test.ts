import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { workerEnv } = vi.hoisted(() => ({
  workerEnv: {} as Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));

vi.mock("cloudflare:workers", () => ({
  env: workerEnv,
}));

const { SITE_DOMAIN } = await import("@/constants");
const {
  createCloudflareApiClient,
  isCloudflareApiError,
} = await import("./cloudflare-api");

/** A fresh module per test: the zone id is memoized for the life of an isolate. */
async function loadCloudflareApi() {
  vi.resetModules();

  return import("./cloudflare-api");
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
    ...init,
  });
}

type FetcherMock = ReturnType<typeof vi.fn<typeof fetch>>;

function getFetchRequest({
  callIndex,
  fetcher,
}: {
  callIndex: number;
  fetcher: FetcherMock;
}): Request {
  const request = fetcher.mock.calls[callIndex]?.[0];

  if (!(request instanceof Request)) {
    throw new Error(`Expected fetch call ${callIndex} to receive a Request.`);
  }

  return request;
}

describe("createCloudflareApiClient", () => {
  test("sends authenticated JSON requests and returns typed Cloudflare envelopes", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({
      success: true,
      errors: [],
      messages: [],
      result: {
        id: "preview-1",
      },
    }));
    const client = createCloudflareApiClient({
      apiToken: " token-1 ",
      baseUrl: "https://api.example.test/client/v4",
      fetcher,
    });

    const response = await client.request<{ id: string }, { batch_size: number }>({
      method: "POST",
      path: "/accounts/account-1/queues/queue-1/messages/preview",
      body: {
        batch_size: 50,
      },
    });

    expect(response.result.id).toBe("preview-1");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = getFetchRequest({ callIndex: 0, fetcher });
    expect(request).toBeInstanceOf(Request);
    expect(request.url).toBe(
      "https://api.example.test/client/v4/accounts/account-1/queues/queue-1/messages/preview",
    );
    expect(request.headers.get("authorization")).toBe("Bearer token-1");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(await request.json()).toEqual({ batch_size: 50 });
  });

  test("throws a structured error for failed Cloudflare envelopes", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => jsonResponse({
      success: false,
      result: null,
      errors: [
        {
          code: 10013,
          message: "queue not found",
        },
      ],
      messages: [],
    }, {
      status: 404,
    }));
    const client = createCloudflareApiClient({
      apiToken: "token-1",
      baseUrl: "https://api.example.test/client/v4",
      fetcher,
    });

    await expect(client.request<{ id: string }>({
      path: "/accounts/account-1/queues/missing",
    })).rejects.toMatchObject({
      name: "CloudflareApiError",
      status: 404,
      errors: [
        {
          code: 10013,
          message: "queue not found",
        },
      ],
    });

    try {
      await client.request<{ id: string }>({
        path: "/accounts/account-1/queues/missing",
      });
    } catch (error) {
      expect(isCloudflareApiError(error)).toBe(true);
    }
  });

  test("iterates paginated list endpoints", async () => {
    const fetcher = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(request instanceof Request ? request.url : request.toString());
      const page = url.searchParams.get("page");

      return jsonResponse({
        success: true,
        errors: [],
        messages: [],
        result: page === "2"
          ? [{ queue_id: "queue-2", queue_name: "second" }]
          : [{ queue_id: "queue-1", queue_name: "first" }],
        result_info: {
          page: page ? Number(page) : 1,
          per_page: 1,
          count: 1,
          total_count: 2,
          total_pages: 2,
        },
      });
    });
    const client = createCloudflareApiClient({
      apiToken: "token-1",
      baseUrl: "https://api.example.test/client/v4",
      fetcher,
    });

    const queues: Array<{ queue_id: string; queue_name: string }> = [];

    for await (const queue of client.paginate<{ queue_id: string; queue_name: string }>({
      path: "/accounts/account-1/queues",
      query: {
        per_page: 1,
      },
    })) {
      queues.push(queue);
    }

    expect(queues).toEqual([
      { queue_id: "queue-1", queue_name: "first" },
      { queue_id: "queue-2", queue_name: "second" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new URL(getFetchRequest({ callIndex: 0, fetcher }).url).searchParams.get("page")).toBe("1");
    expect(new URL(getFetchRequest({ callIndex: 1, fetcher }).url).searchParams.get("page")).toBe("2");
  });
});

describe("the zone helpers", () => {
  let fetcher: FetcherMock;

  beforeEach(() => {
    fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    workerEnv.CLOUDFLARE_ACCOUNT_ID = "account-1";
    workerEnv.CLOUDFLARE_API_TOKEN = "token-1";
    workerEnv.CLOUDFLARE_ZONE_ID = undefined;
    workerEnv.KV_STORE = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function workersDomainsResponse(): Response {
    return jsonResponse({
      success: true,
      errors: [],
      messages: [],
      result: [
        {
          hostname: SITE_DOMAIN,
          service: "worker",
          zone_id: "zone-1",
          zone_name: SITE_DOMAIN,
        },
      ],
    });
  }

  test("it resolves the zone from the Workers domain of the site host, once per isolate", async () => {
    fetcher.mockResolvedValue(workersDomainsResponse());
    const { getWorkerZoneId } = await loadCloudflareApi();

    expect(await getWorkerZoneId()).toBe("zone-1");
    expect(await getWorkerZoneId()).toBe("zone-1");
    expect(fetcher).toHaveBeenCalledTimes(1);

    const url = new URL(getFetchRequest({ callIndex: 0, fetcher }).url);
    expect(url.pathname).toBe("/client/v4/accounts/account-1/workers/domains");
    expect(url.searchParams.get("hostname")).toBe(SITE_DOMAIN);
  });

  test("a failed lookup is answered with null and is never memoized as success", async () => {
    fetcher.mockResolvedValueOnce(jsonResponse({
      success: false,
      result: null,
      errors: [{ code: 10000, message: "Authentication error" }],
      messages: [],
    }, { status: 403 }));
    const { getWorkerZoneId } = await loadCloudflareApi();

    expect(await getWorkerZoneId()).toBeNull();

    fetcher.mockResolvedValueOnce(workersDomainsResponse());

    expect(await getWorkerZoneId()).toBe("zone-1");
  });

  test("a host with no Workers domain resolves to null", async () => {
    fetcher.mockResolvedValue(jsonResponse({
      success: true,
      errors: [],
      messages: [],
      result: [],
    }));
    const { getWorkerZoneId } = await loadCloudflareApi();

    expect(await getWorkerZoneId()).toBeNull();
  });

  function mockZoneIdCache(stored: string | null) {
    const get = vi.fn(async () => stored);
    const put = vi.fn(async () => undefined);

    workerEnv.KV_STORE = { get, put };

    return { get, put };
  }

  test("a cached zone id answers without a Cloudflare request", async () => {
    const { get, put } = mockZoneIdCache("zone-cached");
    const { getWorkerZoneId } = await loadCloudflareApi();

    expect(await getWorkerZoneId()).toBe("zone-cached");
    expect(get).toHaveBeenCalledWith(`worker-zone:${SITE_DOMAIN}`);
    expect(fetcher).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  test("a looked-up zone id is written back under a TTL", async () => {
    const { put } = mockZoneIdCache(null);
    fetcher.mockResolvedValue(workersDomainsResponse());
    const { getWorkerZoneId } = await loadCloudflareApi();

    expect(await getWorkerZoneId()).toBe("zone-1");
    expect(put).toHaveBeenCalledWith(`worker-zone:${SITE_DOMAIN}`, "zone-1", {
      expirationTtl: 24 * 60 * 60,
    });
  });

  test("a failed lookup writes nothing to the cache", async () => {
    const { put } = mockZoneIdCache(null);
    fetcher.mockResolvedValue(jsonResponse({
      success: true,
      errors: [],
      messages: [],
      result: [],
    }));
    const { getWorkerZoneId } = await loadCloudflareApi();

    expect(await getWorkerZoneId()).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  test("an unreadable cache falls back to the lookup", async () => {
    workerEnv.KV_STORE = {
      get: vi.fn(async () => {
        throw new Error("KV unavailable");
      }),
      put: vi.fn(async () => undefined),
    };
    fetcher.mockResolvedValue(workersDomainsResponse());
    const { getWorkerZoneId } = await loadCloudflareApi();

    expect(await getWorkerZoneId()).toBe("zone-1");
  });

  test("CLOUDFLARE_ZONE_ID overrides the lookup and costs no request", async () => {
    workerEnv.CLOUDFLARE_ZONE_ID = " zone-override ";
    const { getCachePurgeConfig } = await loadCloudflareApi();

    expect(await getCachePurgeConfig()).toEqual({
      apiToken: "token-1",
      zoneId: "zone-override",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("the purge config is null without an API token", async () => {
    workerEnv.CLOUDFLARE_API_TOKEN = "  ";
    const { getCachePurgeConfig } = await loadCloudflareApi();

    expect(await getCachePurgeConfig()).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("the purge posts purge_everything to the zone and reports the purge id", async () => {
    fetcher.mockResolvedValue(jsonResponse({
      success: true,
      errors: [],
      messages: [],
      result: { id: "zone-1" },
    }));
    const { purgeZoneCacheEverything } = await loadCloudflareApi();

    expect(await purgeZoneCacheEverything({ apiToken: "token-1", zoneId: "zone-1" })).toEqual({
      purgeId: "zone-1",
    });

    const request = getFetchRequest({ callIndex: 0, fetcher });
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/client/v4/zones/zone-1/purge_cache");
    expect(await request.json()).toEqual({ purge_everything: true });
  });

  test("a tag purge chunks the list into requests of at most 100 tags", async () => {
    // A fresh response per call: two requests read two bodies.
    fetcher.mockImplementation(async () =>
      jsonResponse({ success: true, errors: [], messages: [], result: null }),
    );
    const { purgeZoneCacheTags } = await loadCloudflareApi();
    const tags = Array.from({ length: 101 }, (_, index) => `edge-html:build:/page-${index}`);

    await purgeZoneCacheTags({ apiToken: "token-1", zoneId: "zone-1", tags });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const first = getFetchRequest({ callIndex: 0, fetcher });
    expect(new URL(first.url).pathname).toBe("/client/v4/zones/zone-1/purge_cache");
    expect(await first.json()).toEqual({ tags: tags.slice(0, 100) });
    expect(await getFetchRequest({ callIndex: 1, fetcher }).json()).toEqual({ tags: tags.slice(100) });
  });

  test("a tag purge with no tags sends no request", async () => {
    const { purgeZoneCacheTags } = await loadCloudflareApi();

    await purgeZoneCacheTags({ apiToken: "token-1", zoneId: "zone-1", tags: [] });

    expect(fetcher).not.toHaveBeenCalled();
  });

  test("a refused purge throws with the reasons Cloudflare gave", async () => {
    fetcher.mockResolvedValue(jsonResponse({
      success: false,
      result: null,
      errors: [{ code: 10000, message: "Authentication error" }],
      messages: [],
    }, { status: 403 }));
    const { purgeZoneCacheEverything } = await loadCloudflareApi();

    await expect(
      purgeZoneCacheEverything({ apiToken: "token-1", zoneId: "zone-1" }),
    ).rejects.toThrow("10000: Authentication error");
  });
});
