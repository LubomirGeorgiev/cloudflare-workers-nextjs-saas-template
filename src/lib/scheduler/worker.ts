import { OAUTH_MAINTENANCE_INTERVAL_MINUTES } from "@/constants/oauth";
import { claimPacedRun } from "@/lib/scheduler/paced-run";
import { dispatchScheduledJobsToQueue, getSchedulerQueueDelayLimitSeconds } from "@/lib/scheduler/scheduler";
import { runScheduledJob } from "@/lib/scheduler/job-handlers";
import type { ScheduledQueueMessage } from "@/lib/scheduler/jobs";

// KV key that paces the OAuth sweeps. Renaming it restarts their cadence once.
const OAUTH_MAINTENANCE_TASK = "oauth";

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

// Every maintenance task gets its own settlement: the cron promise is what `waitUntil` keeps the
// isolate alive for, so one rejection short-circuiting a sibling would cut that sibling's work off
// mid-flight. Never rejects, which is what makes the `Promise.all`s below safe.
async function runMaintenanceTask(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(`handleSchedulerCron: ${name} failed`, error);
  }
}

// Settle trial reservations abandoned by a crash or ambiguous Stripe failure against Stripe (never
// a bare TTL delete, which would reopen user-level trial farming). Imported lazily so the sweep's
// server-only graph never loads on billing-disabled deployments.
async function runBillingMaintenance(now: Date): Promise<void> {
  if (!isBillingConfigured()) {
    return;
  }

  await runMaintenanceTask("trial reservation recovery sweep", async () => {
    const { settleStaleTrialReservations } = await import("@/lib/teams/trial-subscription");
    await settleStaleTrialReservations({ now });
  });
}

// OAuth housekeeping: provider GC, stale CIMD mirror pruning, and the renewal touch that keeps
// verified clients' KV records alive. They are independent, so they settle independently.
//
// Queue dispatch and trial recovery need every 5-minute tick; these do not. Their deadlines are
// days wide and the provider sweep pays two KV list operations per call, so KV holds the last run
// and the claim below skips the ticks in between.
async function runOAuthMaintenance({ env, now }: { env: Env; now: Date }): Promise<void> {
  await runMaintenanceTask("OAuth maintenance", async () => {
    const claimed = await claimPacedRun({
      kv: env.NEXT_INC_CACHE_KV,
      task: OAUTH_MAINTENANCE_TASK,
      now,
      intervalMinutes: OAUTH_MAINTENANCE_INTERVAL_MINUTES,
    });

    if (!claimed) {
      return;
    }

    const {
      pruneExpiredUnverifiedCimdOAuthApps,
      purgeExpiredOAuthData,
      renewVerifiedOAuthClients,
    } = await import(
      "@/lib/oauth/oauth-maintenance"
    );

    await Promise.all([
      runMaintenanceTask(
        "OAuth expired CIMD mirror pruning",
        () => pruneExpiredUnverifiedCimdOAuthApps(now),
      ),
      runMaintenanceTask("OAuth expired data purge", () => purgeExpiredOAuthData(now)),
      runMaintenanceTask("OAuth verified client renewal", () => renewVerifiedOAuthClients(now)),
    ]);
  });
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

  // Error-isolated per task, so the sweeps run concurrently and neither can take the other — or
  // the queue dispatch above — down with it.
  await Promise.all([runBillingMaintenance(now), runOAuthMaintenance({ env, now })]);

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
