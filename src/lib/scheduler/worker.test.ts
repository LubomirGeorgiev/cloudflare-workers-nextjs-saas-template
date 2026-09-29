import { afterEach, describe, expect, test, vi } from "vitest";

import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";
import { OAUTH_MAINTENANCE_INTERVAL_MINUTES } from "@/constants/oauth";
import {
  EMAIL_TEMPLATE_TYPES,
  SCHEDULED_JOB_TYPES,
  type ScheduledQueueMessage,
} from "@/lib/scheduler/jobs";

const {
  dispatchScheduledJobsToQueueMock,
  pruneExpiredUnverifiedCimdOAuthAppsMock,
  purgeExpiredOAuthDataMock,
  renewVerifiedOAuthClientsMock,
  runScheduledJobMock,
  settleStaleTrialReservationsMock,
} = vi.hoisted(() => ({
  dispatchScheduledJobsToQueueMock: vi.fn(),
  pruneExpiredUnverifiedCimdOAuthAppsMock: vi.fn(),
  purgeExpiredOAuthDataMock: vi.fn(),
  renewVerifiedOAuthClientsMock: vi.fn(),
  runScheduledJobMock: vi.fn(),
  settleStaleTrialReservationsMock: vi.fn(),
}));

// One record per span, so a test can find a span by its task or job type.
const { recordedSpans } = vi.hoisted(() => ({
  recordedSpans: [] as Array<{
    name: string;
    attributes: Record<string, unknown>;
    exceptions: unknown[];
  }>,
}));

vi.mock("@/utils/trace", () => ({
  withSpan: ({ name, run }: { name: string; run: (span: unknown) => Promise<unknown> }) => {
    const record = { name, attributes: {} as Record<string, unknown>, exceptions: [] as unknown[] };
    const span = {
      isTraced: true,
      record,
      setAttribute: (key: string, value: unknown) => {
        record.attributes[key] = value;
        return span;
      },
      setAttributes: (values: Record<string, unknown>) => {
        Object.assign(record.attributes, values);
        return span;
      },
    };

    recordedSpans.push(record);
    return run(span);
  },
  recordSpanException: ({ span, error }: { span: { record: { exceptions: unknown[] } }; error: unknown }) => {
    span.record.exceptions.push(error);
  },
}));

vi.mock("@/lib/scheduler/scheduler", () => ({
  dispatchScheduledJobsToQueue: dispatchScheduledJobsToQueueMock,
  getSchedulerQueueDelayLimitSeconds: () => 60 * 60 * 24,
}));

vi.mock("@/lib/scheduler/job-handlers", () => ({
  runScheduledJob: runScheduledJobMock,
}));

// The cron's maintenance sweeps are lazy `import()`s of server-only graphs: unmocked they throw
// under plain Vitest and the entrypoint's catch swallows it, so the branch would look covered
// while never running. Mocking the exact specifiers is what makes the assertions below real.
vi.mock("@/lib/oauth/oauth-maintenance", () => ({
  pruneExpiredUnverifiedCimdOAuthApps: pruneExpiredUnverifiedCimdOAuthAppsMock,
  purgeExpiredOAuthData: purgeExpiredOAuthDataMock,
  renewVerifiedOAuthClients: renewVerifiedOAuthClientsMock,
}));

vi.mock("@/lib/teams/trial-subscription", () => ({
  settleStaleTrialReservations: settleStaleTrialReservationsMock,
}));

const BILLING_ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
] as const;

const { handleSchedulerCron, handleSchedulerQueue } = await import("@/lib/scheduler/worker");

const JOB_SPAN_NAME = "app.scheduler.job";
const MAINTENANCE_SPAN_NAME = "app.scheduler.maintenance";
const OUTCOME_ATTRIBUTE = "app.scheduler.outcome";
const TASK_ATTRIBUTE = "app.scheduler.task";

function createMessage({
  attempts = 1,
  body,
  runAt,
}: {
  attempts?: number;
  body?: Omit<ScheduledQueueMessage, "runAt">;
  runAt: Date;
}) {
  return {
    id: "message-1",
    attempts,
    body: {
      ...(body ?? {
        type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
        payload: {
          entryId: "entry-1",
        },
      }),
      runAt: runAt.toISOString(),
    } as ScheduledQueueMessage,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function spansNamed(name: string) {
  return recordedSpans.filter((span) => span.name === name);
}

function maintenanceSpan(task: string) {
  return spansNamed(MAINTENANCE_SPAN_NAME).find((span) => span.attributes[TASK_ATTRIBUTE] === task);
}

// The cron reads the Stripe env directly, so pin it per test instead of inheriting the machine's.
function stubBillingConfigured(isConfigured: boolean) {
  for (const key of BILLING_ENV_KEYS) {
    vi.stubEnv(key, isConfigured ? `stub-${key}` : "");
  }
}

// Makes a mocked sweep finish a macrotask later than its siblings and report whether it actually
// finished, so a test can tell "started" apart from "settled".
function trackSettlement(mock: ReturnType<typeof vi.fn>) {
  let isSettled = false;

  mock.mockImplementationOnce(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    isSettled = true;
  });

  return () => isSettled;
}

const OAUTH_PACING_KEY = `${APP_KV_PREFIXES.maintenanceRun}oauth`;

// The OAuth sweeps are paced by a KV stamp instead of the cron cadence, so every cron run needs a
// namespace. In-memory, so a test can seed "ran at T" or leave it empty for "never ran".
function createPacingKV(lastRunAt?: Date) {
  const store = new Map<string, string>();

  if (lastRunAt) {
    store.set(OAUTH_PACING_KEY, lastRunAt.toISOString());
  }

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

function runCron(now: Date, kv = createPacingKV()) {
  const queue = { send: vi.fn() };

  return {
    queue,
    kv,
    result: handleSchedulerCron({
      env: { SCHEDULER_QUEUE: queue, KV_STORE: kv } as unknown as Env,
      now,
    }),
  };
}

describe("scheduler worker", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    recordedSpans.length = 0;
  });

  test("cron dispatches persisted jobs at the scheduled time", async () => {
    const queue = { send: vi.fn() };
    const now = new Date("2026-05-29T10:00:00.000Z");
    dispatchScheduledJobsToQueueMock.mockResolvedValue(2);

    await expect(handleSchedulerCron({
      env: {
        SCHEDULER_QUEUE: queue,
        KV_STORE: createPacingKV(),
      } as unknown as Env,
      now,
    })).resolves.toBe(2);

    expect(dispatchScheduledJobsToQueueMock).toHaveBeenCalledWith({ queue, now });
  });

  test("cron runs every OAuth maintenance sweep", async () => {
    stubBillingConfigured(false);
    const now = new Date("2026-05-29T10:00:00.000Z");
    dispatchScheduledJobsToQueueMock.mockResolvedValue(2);

    const { queue, result } = runCron(now);

    await expect(result).resolves.toBe(2);
    expect(pruneExpiredUnverifiedCimdOAuthAppsMock).toHaveBeenCalledWith(now);
    expect(purgeExpiredOAuthDataMock).toHaveBeenCalledWith(now);
    expect(renewVerifiedOAuthClientsMock).toHaveBeenCalledWith(now);
    expect(dispatchScheduledJobsToQueueMock).toHaveBeenCalledWith({ queue, now });
    expect(settleStaleTrialReservationsMock).not.toHaveBeenCalled();
  });

  // The 5-minute tick exists for queue dispatch and trial recovery. OAuth sweeps cost two KV list
  // operations per call and have day-wide deadlines, so a tick inside the interval must skip them.
  test("cron skips the OAuth sweeps until the interval has elapsed", async () => {
    stubBillingConfigured(true);
    const now = new Date("2026-05-29T10:35:00.000Z");
    const lastRunAt = new Date(now.getTime() - (OAUTH_MAINTENANCE_INTERVAL_MINUTES - 5) * 60_000);
    dispatchScheduledJobsToQueueMock.mockResolvedValue(0);

    const { kv, result } = runCron(now, createPacingKV(lastRunAt));

    await expect(result).resolves.toBe(0);

    expect(pruneExpiredUnverifiedCimdOAuthAppsMock).not.toHaveBeenCalled();
    expect(purgeExpiredOAuthDataMock).not.toHaveBeenCalled();
    expect(renewVerifiedOAuthClientsMock).not.toHaveBeenCalled();
    // A skipped run must leave the stamp alone, or the interval would restart on every tick.
    expect(kv.store.get(OAUTH_PACING_KEY)).toBe(lastRunAt.toISOString());
    // Queue dispatch and trial recovery keep the full 5-minute cadence.
    expect(settleStaleTrialReservationsMock).toHaveBeenCalledWith({ now });
  });

  test("cron runs the OAuth sweeps once the interval has elapsed", async () => {
    stubBillingConfigured(false);
    const now = new Date("2026-05-29T10:35:00.000Z");
    const lastRunAt = new Date(now.getTime() - OAUTH_MAINTENANCE_INTERVAL_MINUTES * 60_000);
    dispatchScheduledJobsToQueueMock.mockResolvedValue(0);

    const { kv, result } = runCron(now, createPacingKV(lastRunAt));

    await expect(result).resolves.toBe(0);

    expect(purgeExpiredOAuthDataMock).toHaveBeenCalledWith(now);
    // The stamp advances to this run, which is what moves the next one a full interval out.
    expect(kv.store.get(OAUTH_PACING_KEY)).toBe(now.toISOString());
  });

  // Claimed before the work, so a sweep that throws cannot let the next tick start it again.
  test("cron stamps the run before the sweeps it paces", async () => {
    stubBillingConfigured(false);
    const now = new Date("2026-05-29T10:00:00.000Z");
    dispatchScheduledJobsToQueueMock.mockResolvedValue(0);
    let stampedBeforeSweep: string | undefined;
    const kv = createPacingKV();
    purgeExpiredOAuthDataMock.mockImplementationOnce(async () => {
      stampedBeforeSweep = kv.store.get(OAUTH_PACING_KEY);
    });

    await expect(runCron(now, kv).result).resolves.toBe(0);

    expect(stampedBeforeSweep).toBe(now.toISOString());
  });

  test.each([
    {
      failing: pruneExpiredUnverifiedCimdOAuthAppsMock,
      surviving: purgeExpiredOAuthDataMock,
      name: "CIMD pruning",
    },
    { failing: purgeExpiredOAuthDataMock, surviving: renewVerifiedOAuthClientsMock, name: "purge" },
    { failing: renewVerifiedOAuthClientsMock, surviving: purgeExpiredOAuthDataMock, name: "renewal" },
  ])("cron waits for a sibling OAuth sweep to settle when the $name sweep fails", async ({
    failing,
    surviving,
  }) => {
    stubBillingConfigured(false);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const now = new Date("2026-05-29T10:00:00.000Z");
    const failure = new Error("oauth kv unavailable");
    dispatchScheduledJobsToQueueMock.mockResolvedValue(2);
    failing.mockRejectedValueOnce(failure);
    const survived = trackSettlement(surviving);

    const { queue, result } = runCron(now);

    await expect(result).resolves.toBe(2);
    // Called is not enough: `waitUntil` tracks only the cron promise, so a sibling still in flight
    // when it resolves is a sibling the isolate can be torn down under.
    expect(survived()).toBe(true);
    expect(dispatchScheduledJobsToQueueMock).toHaveBeenCalledWith({ queue, now });
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);
    consoleError.mockRestore();
  });

  test("cron settles stale trial reservations only when billing is configured", async () => {
    stubBillingConfigured(true);
    const now = new Date("2026-05-29T10:00:00.000Z");
    dispatchScheduledJobsToQueueMock.mockResolvedValue(0);

    await expect(runCron(now).result).resolves.toBe(0);

    expect(settleStaleTrialReservationsMock).toHaveBeenCalledWith({ now });
    expect(purgeExpiredOAuthDataMock).toHaveBeenCalledWith(now);
  });

  test("a failing billing sweep still lets every OAuth sweep settle", async () => {
    stubBillingConfigured(true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const now = new Date("2026-05-29T10:00:00.000Z");
    const failure = new Error("stripe unavailable");
    dispatchScheduledJobsToQueueMock.mockResolvedValue(1);
    settleStaleTrialReservationsMock.mockRejectedValueOnce(failure);
    const cimdPruned = trackSettlement(pruneExpiredUnverifiedCimdOAuthAppsMock);
    const purged = trackSettlement(purgeExpiredOAuthDataMock);
    const renewed = trackSettlement(renewVerifiedOAuthClientsMock);

    await expect(runCron(now).result).resolves.toBe(1);

    expect(cimdPruned()).toBe(true);
    expect(purged()).toBe(true);
    expect(renewed()).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);
    consoleError.mockRestore();
  });

  test("a failing OAuth sweep still lets the billing sweep settle", async () => {
    stubBillingConfigured(true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const now = new Date("2026-05-29T10:00:00.000Z");
    const failure = new Error("oauth kv unavailable");
    dispatchScheduledJobsToQueueMock.mockResolvedValue(1);
    purgeExpiredOAuthDataMock.mockRejectedValueOnce(failure);
    const settledTrials = trackSettlement(settleStaleTrialReservationsMock);

    await expect(runCron(now).result).resolves.toBe(1);

    expect(settledTrials()).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);
    consoleError.mockRestore();
  });

  test("queue retries a message scheduled for the future", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
    const message = createMessage({
      runAt: new Date("2026-05-29T10:00:30.000Z"),
    });

    await handleSchedulerQueue({
      messages: [message],
    } as unknown as MessageBatch<ScheduledQueueMessage>);

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(runScheduledJobMock).not.toHaveBeenCalled();
  });

  test("queue runs and acknowledges a due message", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
    const message = createMessage({
      runAt: new Date("2026-05-29T10:00:00.000Z"),
    });

    await handleSchedulerQueue({
      messages: [message],
    } as unknown as MessageBatch<ScheduledQueueMessage>);

    expect(runScheduledJobMock).toHaveBeenCalledWith(message.body);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  test("queue retries a failed due message with a linear backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const message = createMessage({
      attempts: 3,
      runAt: new Date("2026-05-29T09:59:59.000Z"),
    });
    runScheduledJobMock.mockRejectedValueOnce(new Error("database unavailable"));

    await handleSchedulerQueue({
      messages: [message],
    } as unknown as MessageBatch<ScheduledQueueMessage>);

    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 90 });
    expect(consoleError).toHaveBeenCalledWith("Scheduled job failed", expect.objectContaining({
      attempts: 3,
      messageId: "message-1",
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
    }));
    consoleError.mockRestore();
  });

  describe("spans", () => {
    test("a deferred message records its job type, attempts, and outcome", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
      const message = createMessage({ attempts: 2, runAt: new Date("2026-05-29T10:00:30.000Z") });

      await handleSchedulerQueue({ messages: [message] } as unknown as MessageBatch<ScheduledQueueMessage>);

      expect(spansNamed(JOB_SPAN_NAME)).toEqual([expect.objectContaining({
        attributes: {
          "app.scheduler.job_type": message.body.type,
          "app.scheduler.attempts": 2,
          [OUTCOME_ATTRIBUTE]: "deferred",
        },
      })]);
    });

    test("an acknowledged email job records its template", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
      const message = createMessage({
        body: {
          type: SCHEDULED_JOB_TYPES.EMAIL_SEND,
          payload: {
            to: "person@example.com",
            template: EMAIL_TEMPLATE_TYPES.PASSWORD_RESET,
            locale: "en",
            data: { resetToken: "token", username: "person" },
          },
        },
        runAt: new Date("2026-05-29T10:00:00.000Z"),
      });

      await handleSchedulerQueue({ messages: [message] } as unknown as MessageBatch<ScheduledQueueMessage>);

      const [span] = spansNamed(JOB_SPAN_NAME);
      expect(span?.attributes).toMatchObject({
        "app.scheduler.job_type": SCHEDULED_JOB_TYPES.EMAIL_SEND,
        "app.scheduler.email_template": EMAIL_TEMPLATE_TYPES.PASSWORD_RESET,
        [OUTCOME_ATTRIBUTE]: "acked",
      });
      // Only code identifiers: nothing from the payload a person wrote or owns.
      expect(JSON.stringify(span?.attributes)).not.toContain("person");
    });

    test("an unknown job type collapses to one value instead of the raw string", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      runScheduledJobMock.mockRejectedValueOnce(new Error("Unknown scheduled job type"));
      const message = createMessage({
        body: { type: "made-up-type", payload: null } as unknown as Omit<ScheduledQueueMessage, "runAt">,
        runAt: new Date("2026-05-29T10:00:00.000Z"),
      });

      await handleSchedulerQueue({ messages: [message] } as unknown as MessageBatch<ScheduledQueueMessage>);

      expect(spansNamed(JOB_SPAN_NAME)[0]?.attributes["app.scheduler.job_type"]).toBe("unknown");
      consoleError.mockRestore();
    });

    test("a failed job records the exception and the retried outcome", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const failure = new Error("database unavailable");
      runScheduledJobMock.mockRejectedValueOnce(failure);
      const message = createMessage({ runAt: new Date("2026-05-29T09:59:59.000Z") });

      await handleSchedulerQueue({ messages: [message] } as unknown as MessageBatch<ScheduledQueueMessage>);

      const [span] = spansNamed(JOB_SPAN_NAME);
      expect(span?.attributes[OUTCOME_ATTRIBUTE]).toBe("retried");
      expect(span?.exceptions).toEqual([failure]);
      expect(message.retry).toHaveBeenCalledOnce();
      consoleError.mockRestore();
    });

    test("each message in a batch gets its own span", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
      const due = createMessage({ runAt: new Date("2026-05-29T10:00:00.000Z") });
      const later = createMessage({ runAt: new Date("2026-05-29T10:05:00.000Z") });

      await handleSchedulerQueue({ messages: [due, later] } as unknown as MessageBatch<ScheduledQueueMessage>);

      expect(spansNamed(JOB_SPAN_NAME).map((span) => span.attributes[OUTCOME_ATTRIBUTE])).toEqual([
        "acked",
        "deferred",
      ]);
    });

    test("a claimed paced run records dispatched for the claim and ok for each sweep", async () => {
      stubBillingConfigured(false);
      dispatchScheduledJobsToQueueMock.mockResolvedValue(0);

      await runCron(new Date("2026-05-29T10:00:00.000Z")).result;

      expect(maintenanceSpan("oauth_maintenance")?.attributes[OUTCOME_ATTRIBUTE]).toBe("dispatched");
      for (const task of [
        "oauth_expired_cimd_prune",
        "oauth_expired_data_purge",
        "oauth_verified_client_renewal",
      ]) {
        expect(maintenanceSpan(task)?.attributes[OUTCOME_ATTRIBUTE]).toBe("ok");
      }
      expect(maintenanceSpan("trial_reservation_recovery")).toBeUndefined();
    });

    test("a paced run another tick holds records skipped_not_claimed", async () => {
      stubBillingConfigured(true);
      const now = new Date("2026-05-29T10:35:00.000Z");
      dispatchScheduledJobsToQueueMock.mockResolvedValue(0);

      await runCron(now, createPacingKV(new Date(now.getTime() - 60_000))).result;

      expect(maintenanceSpan("oauth_maintenance")?.attributes[OUTCOME_ATTRIBUTE]).toBe(
        "skipped_not_claimed",
      );
      expect(maintenanceSpan("oauth_expired_data_purge")).toBeUndefined();
      expect(maintenanceSpan("trial_reservation_recovery")?.attributes[OUTCOME_ATTRIBUTE]).toBe("ok");
    });

    test("a failing sweep records the exception and failed on its own span, not on the claim", async () => {
      stubBillingConfigured(false);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const failure = new Error("oauth kv unavailable");
      dispatchScheduledJobsToQueueMock.mockResolvedValue(0);
      purgeExpiredOAuthDataMock.mockRejectedValueOnce(failure);

      await runCron(new Date("2026-05-29T10:00:00.000Z")).result;

      const failed = maintenanceSpan("oauth_expired_data_purge");
      expect(failed?.attributes[OUTCOME_ATTRIBUTE]).toBe("failed");
      expect(failed?.exceptions).toEqual([failure]);
      expect(maintenanceSpan("oauth_maintenance")?.attributes[OUTCOME_ATTRIBUTE]).toBe("dispatched");
      expect(maintenanceSpan("oauth_maintenance")?.exceptions).toEqual([]);
      expect(consoleError).toHaveBeenCalledWith(
        "handleSchedulerCron: OAuth expired data purge failed",
        failure,
      );
      consoleError.mockRestore();
    });
  });
});
