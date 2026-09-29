import { OAUTH_MAINTENANCE_INTERVAL_MINUTES } from "@/constants/oauth";
import {
  R2_ORPHAN_SWEEP_ENABLED,
  RETENTION_SWEEP_INTERVAL_MINUTES,
} from "@/constants/retention";
import { claimPacedRun } from "@/lib/scheduler/paced-run";
import { dispatchScheduledJobsToQueue, getSchedulerQueueDelayLimitSeconds } from "@/lib/scheduler/scheduler";
import { runScheduledJob } from "@/lib/scheduler/job-handlers";
import {
  EMAIL_TEMPLATE_TYPES,
  SCHEDULED_JOB_TYPES,
  type ScheduledQueueMessage,
} from "@/lib/scheduler/jobs";
import { recordSpanException, withSpan } from "@/utils/trace";

// KV keys that pace the sweeps. Renaming one restarts that cadence once.
const OAUTH_MAINTENANCE_TASK = "oauth";
const RETENTION_TASK = "retention";

const JOB_SPAN_NAME = "app.scheduler.job";
const MAINTENANCE_SPAN_NAME = "app.scheduler.maintenance";
const JOB_TYPE_ATTRIBUTE = "app.scheduler.job_type";
const ATTEMPTS_ATTRIBUTE = "app.scheduler.attempts";
const EMAIL_TEMPLATE_ATTRIBUTE = "app.scheduler.email_template";
const TASK_ATTRIBUTE = "app.scheduler.task";
const OUTCOME_ATTRIBUTE = "app.scheduler.outcome";
// The queue body is not validated before the span, so an unknown value collapses to this.
const UNKNOWN_ATTRIBUTE_VALUE = "unknown";

const JOB_OUTCOME = {
  ACKED: "acked",
  DEFERRED: "deferred",
  RETRIED: "retried",
} as const;

// A task span is `ok` or `failed`. A paced claim span is `skipped_not_claimed` or `dispatched`, and
// each task it dispatched reports its own result, so a child failure never shows on the claim span.
const MAINTENANCE_OUTCOME = {
  DISPATCHED: "dispatched",
  FAILED: "failed",
  OK: "ok",
  SKIPPED_NOT_CLAIMED: "skipped_not_claimed",
} as const;

// Span values for `app.scheduler.task`, each with the label the failure log has always used.
const MAINTENANCE_TASK_LABELS = {
  excess_cms_version_purge: "excess CMS version history purge",
  expired_api_key_purge: "expired API key purge",
  expired_team_invitation_purge: "expired team invitation purge",
  oauth_expired_cimd_prune: "OAuth expired CIMD mirror pruning",
  oauth_expired_data_purge: "OAuth expired data purge",
  oauth_maintenance: "OAuth maintenance",
  oauth_verified_client_renewal: "OAuth verified client renewal",
  orphaned_r2_object_purge: "orphaned R2 object purge",
  retention_maintenance: "retention maintenance",
  trial_reservation_recovery: "trial reservation recovery sweep",
} as const;

const KNOWN_JOB_TYPES: ReadonlySet<string> = new Set(Object.values(SCHEDULED_JOB_TYPES));
const KNOWN_EMAIL_TEMPLATES: ReadonlySet<string> = new Set(Object.values(EMAIL_TEMPLATE_TYPES));

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

function runMaintenanceTask({
  task,
  run,
}: {
  task: MaintenanceTask;
  run: () => Promise<unknown>;
}): Promise<void> {
  return runMaintenanceSpan({
    task,
    run: async () => {
      await run();

      return MAINTENANCE_OUTCOME.OK;
    },
  });
}

// Every maintenance task gets its own settlement: the cron promise is what `waitUntil` keeps the
// isolate alive for, so one rejection short-circuiting a sibling would cut that sibling's work off
// mid-flight. Never rejects, which is what makes the `Promise.all`s below safe.
async function runMaintenanceSpan({
  task,
  run,
}: {
  task: MaintenanceTask;
  run: () => Promise<MaintenanceOutcome>;
}): Promise<void> {
  await withSpan({
    name: MAINTENANCE_SPAN_NAME,
    run: async (span) => {
      span.setAttribute(TASK_ATTRIBUTE, task);

      try {
        span.setAttribute(OUTCOME_ATTRIBUTE, await run());
      } catch (error) {
        console.error(`handleSchedulerCron: ${MAINTENANCE_TASK_LABELS[task]} failed`, error);
        recordSpanException({ span, error });
        span.setAttribute(OUTCOME_ATTRIBUTE, MAINTENANCE_OUTCOME.FAILED);
      }
    },
  });
}

// Settle trial reservations abandoned by a crash or ambiguous Stripe failure against Stripe (never
// a bare TTL delete, which would reopen user-level trial farming). Imported lazily so the sweep's
// server-only graph never loads on billing-disabled deployments.
async function runBillingMaintenance(now: Date): Promise<void> {
  if (!isBillingConfigured()) {
    return;
  }

  await runMaintenanceTask({
    task: "trial_reservation_recovery",
    run: async () => {
      const { settleStaleTrialReservations } = await import("@/lib/teams/trial-subscription");
      await settleStaleTrialReservations({ now });
    },
  });
}

// OAuth housekeeping: provider GC, stale CIMD mirror pruning, and the renewal touch that keeps
// verified clients' KV records alive. They are independent, so they settle independently.
//
// Queue dispatch and trial recovery need every 5-minute tick; these do not. Their deadlines are
// days wide and the provider sweep pays two KV list operations per call, so KV holds the last run
// and the claim below skips the ticks in between.
async function runOAuthMaintenance({ env, now }: { env: Env; now: Date }): Promise<void> {
  await runMaintenanceSpan({
    task: "oauth_maintenance",
    run: async () => {
      const claimed = await claimPacedRun({
        kv: env.KV_STORE,
        task: OAUTH_MAINTENANCE_TASK,
        now,
        intervalMinutes: OAUTH_MAINTENANCE_INTERVAL_MINUTES,
      });

      if (!claimed) {
        return MAINTENANCE_OUTCOME.SKIPPED_NOT_CLAIMED;
      }

      const {
        pruneExpiredUnverifiedCimdOAuthApps,
        purgeExpiredOAuthData,
        renewVerifiedOAuthClients,
      } = await import(
        "@/lib/oauth/oauth-maintenance"
      );

      await Promise.all([
        runMaintenanceTask({
          task: "oauth_expired_cimd_prune",
          run: () => pruneExpiredUnverifiedCimdOAuthApps(now),
        }),
        runMaintenanceTask({
          task: "oauth_expired_data_purge",
          run: () => purgeExpiredOAuthData(now),
        }),
        runMaintenanceTask({
          task: "oauth_verified_client_renewal",
          run: () => renewVerifiedOAuthClients(now),
        }),
      ]);

      return MAINTENANCE_OUTCOME.DISPATCHED;
    },
  });
}

// Data retention: delete the rows whose own lifetime has run out. Nothing here changes what the
// app allows — a revoked or expired credential is already refused everywhere — so these deletes
// only reclaim storage and shorten how long dead personal data is kept.
//
// Paced like the OAuth sweeps: the deadlines are days wide, so most 5-minute ticks skip them. Each
// table settles separately, because one failing must not cost the other its run.
async function runRetentionMaintenance({ env, now }: { env: Env; now: Date }): Promise<void> {
  await runMaintenanceSpan({
    task: "retention_maintenance",
    run: async () => {
      const claimed = await claimPacedRun({
        kv: env.KV_STORE,
        task: RETENTION_TASK,
        now,
        intervalMinutes: RETENTION_SWEEP_INTERVAL_MINUTES,
      });

      if (!claimed) {
        return MAINTENANCE_OUTCOME.SKIPPED_NOT_CLAIMED;
      }

      const {
        purgeExcessCmsEntryVersions,
        purgeExpiredApiKeys,
        purgeExpiredTeamInvitations,
        purgeOrphanedR2Objects,
      } = await import("@/lib/maintenance/retention");
      const bucket = env.R2_BUCKET;

      await Promise.all([
        runMaintenanceTask({ task: "expired_api_key_purge", run: () => purgeExpiredApiKeys(now) }),
        runMaintenanceTask({
          task: "expired_team_invitation_purge",
          run: () => purgeExpiredTeamInvitations(now),
        }),
        // The write path caps history per save, so this only drains entries left over the cap by a
        // save that predates the cap or by a prune that failed post-commit.
        runMaintenanceTask({
          task: "excess_cms_version_purge",
          run: () => purgeExcessCmsEntryVersions(),
        }),
        // Skipped rather than failed where the deployment has no bucket bound: the CMS media feature
        // is optional, and a missing binding is a configuration choice, not an error. The same for
        // the sweep flag, which a fork turns off when it writes objects the app never records.
        ...(bucket && R2_ORPHAN_SWEEP_ENABLED
          ? [runMaintenanceTask({
              task: "orphaned_r2_object_purge",
              run: () => purgeOrphanedR2Objects({ bucket, kv: env.KV_STORE, now }),
            })]
          : []),
      ]);

      return MAINTENANCE_OUTCOME.DISPATCHED;
    },
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
    await withSpan({
      name: JOB_SPAN_NAME,
      run: async (span) => {
        if (span.isTraced) {
          span.setAttributes(getJobSpanAttributes(message));
        }

        span.setAttribute(OUTCOME_ATTRIBUTE, await processSchedulerMessage({ message, span }));
      },
    });
  }
}

async function processSchedulerMessage({
  message,
  span,
}: {
  message: Message<ScheduledQueueMessage>;
  span: Span;
}): Promise<JobOutcome> {
  try {
    const secondsUntilRun = getSecondsUntilRunAt(message.body.runAt);

    if (secondsUntilRun > 0) {
      message.retry({
        delaySeconds: Math.min(secondsUntilRun, getSchedulerQueueDelayLimitSeconds()),
      });
      return JOB_OUTCOME.DEFERRED;
    }

    await runScheduledJob(message.body);
    message.ack();
    return JOB_OUTCOME.ACKED;
  } catch (error) {
    console.error("Scheduled job failed", {
      error,
      messageId: message.id,
      type: message.body.type,
      attempts: message.attempts,
    });
    recordSpanException({ span, error });

    message.retry({
      delaySeconds: getRetryDelaySeconds(message.attempts),
    });
    return JOB_OUTCOME.RETRIED;
  }
}

// Reads the payload defensively: it is unvalidated here, and a throw would skip the retry below.
function getJobSpanAttributes(message: Message<ScheduledQueueMessage>): Record<string, string | number> {
  const { payload, type } = message.body as { payload?: unknown; type?: unknown };
  const attributes: Record<string, string | number> = {
    [JOB_TYPE_ATTRIBUTE]: toKnownValue({ value: type, known: KNOWN_JOB_TYPES }),
    [ATTEMPTS_ATTRIBUTE]: message.attempts,
  };

  if (type === SCHEDULED_JOB_TYPES.EMAIL_SEND) {
    const template = typeof payload === "object" && payload !== null && "template" in payload
      ? payload.template
      : undefined;

    attributes[EMAIL_TEMPLATE_ATTRIBUTE] = toKnownValue({ value: template, known: KNOWN_EMAIL_TEMPLATES });
  }

  return attributes;
}

function toKnownValue({ value, known }: { value: unknown; known: ReadonlySet<string> }): string {
  return typeof value === "string" && known.has(value) ? value : UNKNOWN_ATTRIBUTE_VALUE;
}

type JobOutcome = typeof JOB_OUTCOME[keyof typeof JOB_OUTCOME];
type MaintenanceTask = keyof typeof MAINTENANCE_TASK_LABELS;
type MaintenanceOutcome = typeof MAINTENANCE_OUTCOME[keyof typeof MAINTENANCE_OUTCOME];
