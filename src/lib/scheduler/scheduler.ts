import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";

import { getDB } from "@/db";
import { scheduledJobTable } from "@/db/schema";
import {
  createScheduledQueueMessage,
  type ScheduledJobPayload,
  type ScheduledJobType,
  type SchedulerQueue,
} from "@/lib/scheduler/jobs";

const QUEUE_DELAY_LIMIT_SECONDS = 60 * 60 * 24;
const SCHEDULER_DISPATCH_LIMIT = 200;

interface ScheduleJobParams<T extends ScheduledJobType = ScheduledJobType> {
  queue: SchedulerQueue;
  type: T;
  dedupeKey?: string;
  payload: ScheduledJobPayload<T>;
  runAt: Date;
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

export async function scheduleJob<T extends ScheduledJobType>({
  queue,
  type,
  dedupeKey = createId(),
  payload,
  runAt,
}: ScheduleJobParams<T>): Promise<"queued" | "persisted"> {
  const delaySeconds = getDelaySeconds(runAt);

  if (delaySeconds <= QUEUE_DELAY_LIMIT_SECONDS) {
    await queue.send(createScheduledQueueMessage({ type, payload, runAt }), { delaySeconds });
    await deleteScheduledJobs({ type, dedupeKey });
    return "queued";
  }

  const db = getDB();
  await db
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
