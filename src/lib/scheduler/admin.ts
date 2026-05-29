import "server-only";

import { env as workerEnv } from "cloudflare:workers";
import { asc } from "drizzle-orm";

import { getDB } from "@/db";
import { getCloudflareApiClient, isCloudflareApiError } from "@/lib/cloudflare-api";
import { scheduledJobTable, type ScheduledJob } from "@/db/schema";

const DEFAULT_QUEUE_PREVIEW_BATCH_SIZE = 50;

declare const __SCHEDULER_QUEUE_NAME__: string;

type SchedulerQueueMetrics = Awaited<ReturnType<Cloudflare.Env["SCHEDULER_QUEUE"]["metrics"]>>;
type ScheduledJobAdminRow = Pick<
  ScheduledJob,
  "id" | "type" | "dedupeKey" | "payload" | "runAt" | "createdAt" | "updatedAt"
>;
export type ScheduledJobTableRow = Omit<
  Pick<ScheduledJobAdminRow, "id" | "type" | "dedupeKey" | "payload" | "runAt">,
  "runAt"
> & {
  runAt: string;
};

interface CloudflareQueuePreviewMessage {
  attempts: number;
  body: string;
  id: string;
  metadata?: Record<string, unknown>;
  timestamp_ms: number;
}

interface CloudflareQueuePreviewResult {
  messages: CloudflareQueuePreviewMessage[];
}

interface CloudflareQueueListItem {
  queue_id?: string;
  queue_name?: string;
}

interface QueuePreviewAdminMessage {
  id: string;
  attempts: number;
  body: unknown;
  bodyText: string;
  metadata: Record<string, unknown>;
  publishedAt: Date;
}

export type QueueMessageTableRow = Omit<QueuePreviewAdminMessage, "body" | "publishedAt"> & {
  publishedAt: string;
};

type QueuePreviewState =
  | {
      status: "ready";
      queueId: string;
      queueName: string;
      messages: QueuePreviewAdminMessage[];
    }
  | {
      status: "missing-config";
      queueName: string;
      missing: string[];
    }
  | {
      status: "not-found";
      queueName: string;
      message: string;
    }
  | {
      status: "error";
      queueName: string;
      message: string;
    };

export type QueuePreviewTableState =
  | Exclude<QueuePreviewState, { status: "ready" }>
  | (Omit<Extract<QueuePreviewState, { status: "ready" }>, "messages"> & {
      messages: QueueMessageTableRow[];
    });

type QueueMetricsState =
  | ({
      status: "ready";
      queueName: string;
      oldestMessageTimestamp: NonNullable<SchedulerQueueMetrics["oldestMessageTimestamp"]> | null;
    } & Pick<SchedulerQueueMetrics, "backlogBytes" | "backlogCount">)
  | {
      status: "missing-binding";
      message: string;
      queueName: string;
    }
  | {
      status: "error";
      message: string;
      queueName: string;
    };

export type QueueMetricsTableState =
  | Exclude<QueueMetricsState, { status: "ready" }>
  | (Omit<Extract<QueueMetricsState, { status: "ready" }>, "oldestMessageTimestamp"> & {
      oldestMessageTimestamp: string | null;
    });

function getOptionalEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getQueueName(): string {
  const queueName = __SCHEDULER_QUEUE_NAME__.trim();

  if (!queueName) {
    throw new Error("Scheduler queue name was not injected by the build.");
  }

  return queueName;
}

async function resolveQueueId({
  accountId,
  client,
  queueName,
}: {
  accountId: string;
  client: ReturnType<typeof getCloudflareApiClient>;
  queueName: string;
}): Promise<string | null> {
  for await (const queue of client.paginate<CloudflareQueueListItem>({
    path: `/accounts/${accountId}/queues`,
  })) {
    if (queue.queue_name === queueName) {
      return queue.queue_id ?? null;
    }
  }

  return null;
}

function getCloudflareAdminErrorMessage({
  error,
  fallback,
}: {
  error: unknown;
  fallback: string;
}): string {
  if (isCloudflareApiError(error)) {
    if (error.errors.length > 0) {
      return error.errors
        .map((apiError) => `${apiError.code}: ${apiError.message}`)
        .join("; ");
    }

    return error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function decodeBase64Utf8(value: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function parseMessageBody(message: CloudflareQueuePreviewMessage): {
  body: unknown;
  bodyText: string;
} {
  const rawBody = message.body;
  const contentType = String(message.metadata?.["CF-Content-Type"] ?? "");
  const decodedBody = contentType === "json" || contentType === "bytes"
    ? decodeBase64Utf8(rawBody)
    : null;
  const bodyCandidates = [decodedBody, rawBody].filter((value): value is string => Boolean(value));

  for (const candidate of bodyCandidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return {
        body: parsed,
        bodyText: JSON.stringify(parsed, null, 2),
      };
    } catch {
      // Keep trying fallbacks because Queue preview encodes bodies differently by content type.
    }
  }

  return {
    body: decodedBody ?? rawBody,
    bodyText: decodedBody ?? rawBody,
  };
}

export async function listScheduledJobsForAdmin(): Promise<ScheduledJobAdminRow[]> {
  const db = getDB();
  const jobs = await db.query.scheduledJobTable.findMany({
    orderBy: [asc(scheduledJobTable.runAt)],
    limit: 100,
  });

  return jobs.map((job) => ({
    id: job.id,
    type: job.type,
    dedupeKey: job.dedupeKey,
    payload: job.payload,
    runAt: job.runAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }));
}

export async function getSchedulerQueueMetricsForAdmin(): Promise<QueueMetricsState> {
  const queueName = getQueueName();

  const queue = workerEnv.SCHEDULER_QUEUE;

  if (!queue) {
    return {
      status: "missing-binding",
      queueName,
      message: "SCHEDULER_QUEUE is not available in the Worker environment.",
    };
  }

  try {
    const metrics = await queue.metrics();

    return {
      status: "ready",
      queueName,
      backlogBytes: metrics.backlogBytes,
      backlogCount: metrics.backlogCount,
      oldestMessageTimestamp: metrics.oldestMessageTimestamp ?? null,
    };
  } catch (error) {
    return {
      status: "error",
      queueName,
      message: error instanceof Error ? error.message : "Unable to load scheduler queue metrics.",
    };
  }
}

export async function previewSchedulerQueueForAdmin(): Promise<QueuePreviewState> {
  const queueName = getQueueName();
  const accountId = getOptionalEnvValue(workerEnv.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = getOptionalEnvValue(workerEnv.CLOUDFLARE_API_TOKEN);
  const missing = [
    accountId ? null : "CLOUDFLARE_ACCOUNT_ID",
    apiToken ? null : "CLOUDFLARE_API_TOKEN",
  ].filter((value): value is string => Boolean(value));

  if (!accountId || !apiToken) {
    return {
      status: "missing-config",
      queueName,
      missing,
    };
  }

  try {
    const client = getCloudflareApiClient({ apiToken });
    const resolvedQueueId = await resolveQueueId({
      accountId,
      client,
      queueName,
    });

    if (!resolvedQueueId) {
      return {
        status: "not-found",
        queueName,
        message: `No Cloudflare Queue named "${queueName}" was found for this account.`,
      };
    }

    const previewResponse = await client.request<
      CloudflareQueuePreviewResult,
      { batch_size: number }
    >({
      method: "POST",
      path: `/accounts/${accountId}/queues/${resolvedQueueId}/messages/preview`,
      body: { batch_size: DEFAULT_QUEUE_PREVIEW_BATCH_SIZE },
    });
    const preview = previewResponse.result;

    return {
      status: "ready",
      queueId: resolvedQueueId,
      queueName,
      messages: preview.messages.map((message) => {
        const parsedBody = parseMessageBody(message);

        return {
          id: message.id,
          attempts: message.attempts,
          body: parsedBody.body,
          bodyText: parsedBody.bodyText,
          metadata: message.metadata ?? {},
          publishedAt: new Date(message.timestamp_ms),
        };
      }),
    };
  } catch (error) {
    return {
      status: "error",
      queueName,
      message: getCloudflareAdminErrorMessage({
        error,
        fallback: "Unable to preview Cloudflare Queue messages.",
      }),
    };
  }
}
