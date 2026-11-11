import { and, eq } from "drizzle-orm";

import { getDB } from "@/db";
import { scheduledJobTable } from "@/db/schema";
import {
  createScheduledQueueMessage,
  type ScheduledJobPayload,
  type ScheduledJobType,
  type SchedulerQueue,
} from "@/lib/scheduler/jobs";
import { createRandomId } from "@/utils/random-token";

const QUEUE_DELAY_LIMIT_SECONDS = 60 * 60 * 24;
const SCHEDULER_DISPATCH_LIMIT = 200;

interface ScheduleJobParams<T extends ScheduledJobType = ScheduledJobType> {
  queue: SchedulerQueue;
  type: T;
  dedupeKey?: string;
  payload: ScheduledJobPayload<T>;
  runAt: Date;
  /**
   * Write the D1 row before the send, and remove it only after the send returns. A failed send or
   * delete resolves `"persisted"`: `dispatchScheduledJobsToQueue` sends the row on the next cron.
   * Only a failed insert rejects. Use it for work nothing else will ever ask for again.
   */
  durable?: boolean;
}

interface DeleteScheduledJobsParams {
  type: ScheduledJobType;
  dedupeKey: string;
}

interface DispatchScheduledJobsParams {
  queue: SchedulerQueue;
  now?: Date;
  limit?: number;
}

function getDelaySeconds(runAt: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((runAt.getTime() - now.getTime()) / 1000));
}

export async function deleteScheduledJobs({
  type,
  dedupeKey,
}: DeleteScheduledJobsParams): Promise<void> {
  const db = getDB();

  await db
    .delete(scheduledJobTable)
    .where(and(
      eq(scheduledJobTable.type, type),
      eq(scheduledJobTable.dedupeKey, dedupeKey),
    ));
}

/** Exported so a fork can save a job row before a step whose failure must not lose the job. */
export async function persistScheduledJob<T extends ScheduledJobType>({
  type,
  dedupeKey,
  payload,
  runAt,
}: {
  type: T;
  dedupeKey: string;
  payload: ScheduledJobPayload<T>;
  runAt: Date;
}): Promise<void> {
  await getDB()
    .insert(scheduledJobTable)
    .values({
      type,
      dedupeKey,
      payload,
      runAt,
    })
    .onConflictDoUpdate({
      target: [scheduledJobTable.type, scheduledJobTable.dedupeKey],
      set: {
        payload,
        runAt,
        updatedAt: new Date(),
      },
    });
}

export async function scheduleJob<T extends ScheduledJobType>({
  queue,
  type,
  dedupeKey = createRandomId(),
  payload,
  runAt,
  durable = false,
}: ScheduleJobParams<T>): Promise<"queued" | "persisted"> {
  const delaySeconds = getDelaySeconds(runAt);

  if (delaySeconds <= QUEUE_DELAY_LIMIT_SECONDS) {
    if (!durable) {
      await queue.send(createScheduledQueueMessage({ type, payload, runAt }), { delaySeconds });
      await deleteScheduledJobs({ type, dedupeKey });
      return "queued";
    }

    await persistScheduledJob({ type, dedupeKey, payload, runAt });
    // The saved row is the job now, so a failed send or delete only leaves it for the cron.
    // A send that lands before a failed delete dispatches twice: the job handler must be idempotent.
    let step: "send" | "delete" = "send";
    try {
      await queue.send(createScheduledQueueMessage({ type, payload, runAt }), { delaySeconds });
      step = "delete";
      await deleteScheduledJobs({ type, dedupeKey });
      return "queued";
    } catch (error) {
      console.error(JSON.stringify({
        event: "scheduled_job_durable_step_failed",
        provider: step === "send" ? "cloudflare_queues" : "d1",
        operation: step,
        jobType: type,
        errorName: error instanceof Error ? error.name : "unknown",
      }));
      return "persisted";
    }
  }

  await persistScheduledJob({ type, dedupeKey, payload, runAt });

  return "persisted";
}

export async function dispatchScheduledJobsToQueue({
  queue,
  now = new Date(),
  limit = SCHEDULER_DISPATCH_LIMIT,
}: DispatchScheduledJobsParams): Promise<number> {
  const db = getDB();
  const dispatchBefore = new Date(now.getTime() + QUEUE_DELAY_LIMIT_SECONDS * 1000);
  const jobs = await db.query.scheduledJobTable.findMany({
    where: { runAt: { lte: dispatchBefore } },
    orderBy: { runAt: "asc" },
    limit,
  });

  let dispatchedCount = 0;

  for (const job of jobs) {
    const delaySeconds = getDelaySeconds(job.runAt, now);
    await queue.send(
      createScheduledQueueMessage({
        type: job.type,
        payload: job.payload,
        runAt: job.runAt,
      }),
      { delaySeconds },
    );

    await db
      .delete(scheduledJobTable)
      .where(eq(scheduledJobTable.id, job.id));

    dispatchedCount += 1;
  }

  return dispatchedCount;
}

export function getSchedulerQueueDelayLimitSeconds(): number {
  return QUEUE_DELAY_LIMIT_SECONDS;
}
