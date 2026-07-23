import { dispatchScheduledJobsToQueue, getSchedulerQueueDelayLimitSeconds } from "@/lib/scheduler/scheduler";
import { runScheduledJob } from "@/lib/scheduler/job-handlers";
import type { ScheduledQueueMessage } from "@/lib/scheduler/jobs";

// Mirrors isBillingEnabled() from @/flags, inlined to keep this cron entrypoint free of the
// server-only trial-recovery graph at module load; the Stripe-dependent sweep is imported
// lazily only when billing is actually configured.
function isBillingConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  );
}

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
  const scheduledJobsCount = await dispatchScheduledJobsToQueue({ queue, now });

  // Settle trial reservations abandoned by a crash or ambiguous Stripe failure against
  // Stripe (never a bare TTL delete, which would reopen user-level trial farming). Isolated
  // so a Stripe outage cannot break queue dispatch; imported lazily so the sweep's
  // server-only graph never loads on billing-disabled deployments.
  if (isBillingConfigured()) {
    try {
      const { settleStaleTrialReservations } = await import("@/lib/teams/trial-subscription");
      await settleStaleTrialReservations({ now });
    } catch (error) {
      console.error("handleSchedulerCron: trial reservation recovery sweep failed", error);
    }
  }

  return scheduledJobsCount;
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
