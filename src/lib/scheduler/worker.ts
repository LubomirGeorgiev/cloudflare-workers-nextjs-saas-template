import { OAUTH_MAINTENANCE_INTERVAL_MINUTES } from "@/constants/oauth";
import {
  R2_ORPHAN_SWEEP_ENABLED,
  RETENTION_SWEEP_INTERVAL_MINUTES,
} from "@/constants/retention";
import { claimPacedRun } from "@/lib/scheduler/paced-run";
import { dispatchScheduledJobsToQueue, getSchedulerQueueDelayLimitSeconds } from "@/lib/scheduler/scheduler";
import { runScheduledJob } from "@/lib/scheduler/job-handlers";
import type { ScheduledQueueMessage } from "@/lib/scheduler/jobs";

// KV keys that pace the sweeps. Renaming one restarts that cadence once.
const OAUTH_MAINTENANCE_TASK = "oauth";
const RETENTION_TASK = "retention";

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
      kv: env.KV_STORE,
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

// Data retention: delete the rows whose own lifetime has run out. Nothing here changes what the
// app allows — a revoked or expired credential is already refused everywhere — so these deletes
// only reclaim storage and shorten how long dead personal data is kept.
//
// Paced like the OAuth sweeps: the deadlines are days wide, so most 5-minute ticks skip them. Each
// table settles separately, because one failing must not cost the other its run.
async function runRetentionMaintenance({ env, now }: { env: Env; now: Date }): Promise<void> {
  await runMaintenanceTask("retention maintenance", async () => {
    const claimed = await claimPacedRun({
      kv: env.KV_STORE,
      task: RETENTION_TASK,
      now,
      intervalMinutes: RETENTION_SWEEP_INTERVAL_MINUTES,
    });

    if (!claimed) {
      return;
    }

    const {
      purgeExcessCmsEntryVersions,
      purgeExpiredApiKeys,
      purgeExpiredTeamInvitations,
      purgeOrphanedR2Objects,
    } = await import("@/lib/maintenance/retention");
    const bucket = env.R2_BUCKET;

    await Promise.all([
      runMaintenanceTask("expired API key purge", () => purgeExpiredApiKeys(now)),
      runMaintenanceTask("expired team invitation purge", () => purgeExpiredTeamInvitations(now)),
      // The write path caps history per save, so this only drains entries left over the cap by a
      // save that predates the cap or by a prune that failed post-commit.
      runMaintenanceTask("excess CMS version history purge", () => purgeExcessCmsEntryVersions()),
      // Skipped rather than failed where the deployment has no bucket bound: the CMS media feature
      // is optional, and a missing binding is a configuration choice, not an error. The same for
      // the sweep flag, which a fork turns off when it writes objects the app never records.
      ...(bucket && R2_ORPHAN_SWEEP_ENABLED
        ? [runMaintenanceTask(
            "orphaned R2 object purge",
            () => purgeOrphanedR2Objects({ bucket, kv: env.KV_STORE, now }),
          )]
        : []),
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
  await Promise.all([
    runBillingMaintenance(now),
    runOAuthMaintenance({ env, now }),
    runRetentionMaintenance({ env, now }),
  ]);

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
