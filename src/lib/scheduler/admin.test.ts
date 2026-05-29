import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const {
  getCloudflareApiClientMock,
  isCloudflareApiErrorMock,
  workerEnv,
} = vi.hoisted(() => ({
  getCloudflareApiClientMock: vi.fn(),
  isCloudflareApiErrorMock: vi.fn(() => false),
  workerEnv: {} as Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));

vi.mock("cloudflare:workers", () => ({
  env: workerEnv,
}));

vi.mock("@/db", () => ({
  getDB: vi.fn(),
}));

vi.mock("@/lib/cloudflare-api", () => ({
  getCloudflareApiClient: getCloudflareApiClientMock,
  isCloudflareApiError: isCloudflareApiErrorMock,
}));

const { previewSchedulerQueueForAdmin } = await import("@/lib/scheduler/admin");

function encodeBase64(value: string): string {
  return btoa(value);
}

describe("scheduler admin queue preview", () => {
  beforeEach(() => {
    vi.stubGlobal("__SCHEDULER_QUEUE_NAME__", "scheduler-queue");
  });

  afterEach(() => {
    for (const key of Object.keys(workerEnv)) {
      delete workerEnv[key];
    }
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test("reports missing Cloudflare API configuration", async () => {
    workerEnv.CLOUDFLARE_ACCOUNT_ID = " ";
    workerEnv.CLOUDFLARE_API_TOKEN = "";

    await expect(previewSchedulerQueueForAdmin()).resolves.toEqual({
      status: "missing-config",
      queueName: "scheduler-queue",
      missing: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
    });
  });

  test("reports when the configured queue is not found", async () => {
    workerEnv.CLOUDFLARE_ACCOUNT_ID = "account-1";
    workerEnv.CLOUDFLARE_API_TOKEN = "token-1";
    getCloudflareApiClientMock.mockReturnValue({
      paginate: async function* () {
        yield { queue_id: "queue-1", queue_name: "other-queue" };
      },
    });

    await expect(previewSchedulerQueueForAdmin()).resolves.toMatchObject({
      status: "not-found",
      queueName: "scheduler-queue",
    });
  });

  test("decodes base64 JSON queue preview bodies", async () => {
    workerEnv.CLOUDFLARE_ACCOUNT_ID = "account-1";
    workerEnv.CLOUDFLARE_API_TOKEN = "token-1";
    const request = vi.fn(async () => ({
      success: true,
      errors: [],
      messages: [],
      result: {
        messages: [
          {
            id: "message-1",
            attempts: 2,
            body: encodeBase64(JSON.stringify({ type: "credits.refresh-user" })),
            metadata: { "CF-Content-Type": "json" },
            timestamp_ms: Date.parse("2026-05-29T10:00:00.000Z"),
          },
        ],
      },
    }));
    getCloudflareApiClientMock.mockReturnValue({
      paginate: async function* () {
        yield { queue_id: "queue-1", queue_name: "scheduler-queue" };
      },
      request,
    });

    await expect(previewSchedulerQueueForAdmin()).resolves.toMatchObject({
      status: "ready",
      queueId: "queue-1",
      queueName: "scheduler-queue",
      messages: [
        {
          id: "message-1",
          attempts: 2,
          body: { type: "credits.refresh-user" },
          bodyText: "{\n  \"type\": \"credits.refresh-user\"\n}",
          metadata: { "CF-Content-Type": "json" },
          publishedAt: new Date("2026-05-29T10:00:00.000Z"),
        },
      ],
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/accounts/account-1/queues/queue-1/messages/preview",
      body: { batch_size: 50 },
    });
  });

  test("falls back to readable text for non-JSON queue preview bodies", async () => {
    workerEnv.CLOUDFLARE_ACCOUNT_ID = "account-1";
    workerEnv.CLOUDFLARE_API_TOKEN = "token-1";
    getCloudflareApiClientMock.mockReturnValue({
      paginate: async function* () {
        yield { queue_id: "queue-1", queue_name: "scheduler-queue" };
      },
      request: vi.fn(async () => ({
        success: true,
        errors: [],
        messages: [],
        result: {
          messages: [
            {
              id: "message-1",
              attempts: 1,
              body: encodeBase64("not-json"),
              metadata: { "CF-Content-Type": "bytes" },
              timestamp_ms: Date.parse("2026-05-29T10:00:00.000Z"),
            },
          ],
        },
      })),
    });

    const preview = await previewSchedulerQueueForAdmin();

    expect(preview).toMatchObject({
      status: "ready",
      messages: [
        {
          body: "not-json",
          bodyText: "not-json",
        },
      ],
    });
  });
});
