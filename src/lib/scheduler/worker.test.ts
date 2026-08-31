import { afterEach, describe, expect, test, vi } from "vitest";

import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";
import { OAUTH_MAINTENANCE_INTERVAL_MINUTES } from "@/constants/oauth";
import { SCHEDULED_JOB_TYPES, type ScheduledQueueMessage } from "@/lib/scheduler/jobs";

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

function createMessage({
  attempts = 1,
  runAt,
}: {
  attempts?: number;
  runAt: Date;
}) {
  return {
    id: "message-1",
    attempts,
    body: {
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      payload: {
        entryId: "entry-1",
      },
      runAt: runAt.toISOString(),
    } satisfies ScheduledQueueMessage,
    ack: vi.fn(),
    retry: vi.fn(),
  };
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
});
