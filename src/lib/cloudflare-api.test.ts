import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  createCloudflareApiClient,
  isCloudflareApiError,
} = await import("./cloudflare-api");

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
