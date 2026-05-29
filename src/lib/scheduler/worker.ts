import { dispatchScheduledJobsToQueue, getSchedulerQueueDelayLimitSeconds } from "@/lib/scheduler/scheduler";
import { runScheduledJob } from "@/lib/scheduler/job-handlers";
import type { ScheduledQueueMessage } from "@/lib/scheduler/jobs";
import {
  dispatchDueCreditExpirationJobs,
  dispatchDueCreditRefreshJobs,
} from "@/utils/credit-scheduler";

function getRetryDelaySeconds(attempts: number): number {
  const baseDelaySeconds = 30;
  const delaySeconds = baseDelaySeconds * Math.max(1, attempts);
  return Math.min(delaySeconds, getSchedulerQueueDelayLimitSeconds());
}

function getSecondsUntilRunAt(runAt: string): number {
  return Math.ceil((new Date(runAt).getTime() - Date.now()) / 1000);
}

export async function handleSchedulerCron({
  env,
  now = new Date(),
}: {
  env: Env;
  now?: Date;
}): Promise<number> {
  const queue = env.SCHEDULER_QUEUE;
  const [
    scheduledJobsCount,
    creditExpirationJobsCount,
    creditRefreshJobsCount,
  ] = await Promise.all([
    dispatchScheduledJobsToQueue({ queue, now }),
    dispatchDueCreditExpirationJobs({ queue, now }),
    dispatchDueCreditRefreshJobs({ queue, now }),
  ]);

  return scheduledJobsCount
    + creditExpirationJobsCount
    + creditRefreshJobsCount;
}

export async function handleSchedulerQueue(batch: MessageBatch<ScheduledQueueMessage>): Promise<void> {
  for (const message of batch.messages) {
    try {
      const secondsUntilRun = getSecondsUntilRunAt(message.body.runAt);

      if (secondsUntilRun > 0) {
        message.retry({
          delaySeconds: Math.min(secondsUntilRun, getSchedulerQueueDelayLimitSeconds()),
        });
        continue;
      }

      await runScheduledJob(message.body);
      message.ack();
    } catch (error) {
      console.error("Scheduled job failed", {
        error,
        messageId: message.id,
        type: message.body.type,
        attempts: message.attempts,
      });

      message.retry({
        delaySeconds: getRetryDelaySeconds(message.attempts),
      });
    }
  }
}
