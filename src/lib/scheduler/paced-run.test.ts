import { describe, expect, test, vi } from "vitest";

import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";
import { claimPacedRun } from "@/lib/scheduler/paced-run";

const TASK = "oauth";
const KEY = `${APP_KV_PREFIXES.maintenanceRun}${TASK}`;
const INTERVAL_MINUTES = 60;
const NOW = new Date("2026-05-29T10:00:00.000Z");

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

function createKV({ stored, readError }: { stored?: string; readError?: Error } = {}) {
  const store = new Map<string, string>();

  if (stored !== undefined) {
    store.set(KEY, stored);
  }

  return {
    store,
    get: vi.fn(async (key: string) => {
      if (readError) {
        throw readError;
      }

      return store.get(key) ?? null;
    }),
    put: vi.fn(async (key: string, value: string, __options?: KVNamespacePutOptions) => {
      store.set(key, value);
    }),
  };
}

function claim(kv: ReturnType<typeof createKV>, now = NOW) {
  return claimPacedRun({
    kv: kv as unknown as KVNamespace,
    task: TASK,
    now,
    intervalMinutes: INTERVAL_MINUTES,
  });
}

describe("claimPacedRun", () => {
  test("claims when the task has never run", async () => {
    const kv = createKV();

    await expect(claim(kv)).resolves.toBe(true);
    expect(kv.store.get(KEY)).toBe(NOW.toISOString());
  });

  // The gate is the elapsed time, so the cadence holds whatever interval the cron itself ticks on.
  test.each([
    { minutesAgo: 0, expected: false, name: "just ran" },
    { minutesAgo: INTERVAL_MINUTES - 1, expected: false, name: "one minute short" },
    { minutesAgo: INTERVAL_MINUTES, expected: true, name: "exactly the interval" },
    { minutesAgo: INTERVAL_MINUTES * 5, expected: true, name: "long overdue" },
  ])("$name: claims=$expected", async ({ minutesAgo, expected }) => {
    const kv = createKV({ stored: minutesBefore(minutesAgo).toISOString() });

    await expect(claim(kv)).resolves.toBe(expected);
  });

  test("leaves the stamp untouched when it does not claim", async () => {
    const stored = minutesBefore(5).toISOString();
    const kv = createKV({ stored });

    await expect(claim(kv)).resolves.toBe(false);
    expect(kv.put).not.toHaveBeenCalled();
    expect(kv.store.get(KEY)).toBe(stored);
  });

  // Stamping before the work is what stops a slow or failing run from overlapping the next tick.
  test("writes the stamp before it reports the claim", async () => {
    const kv = createKV();
    let stampedAtClaim: string | undefined;
    kv.put.mockImplementationOnce(async (key: string, value: string) => {
      kv.store.set(key, value);
      stampedAtClaim = kv.store.get(KEY);
    });

    await expect(claim(kv)).resolves.toBe(true);
    expect(stampedAtClaim).toBe(NOW.toISOString());
  });

  // Every unknown-cadence case fails toward running: a stall is the failure that hides.
  test.each([
    { stored: "not-a-date", name: "an unparsable stamp" },
    { stored: "", name: "an empty stamp" },
  ])("claims despite $name", async ({ stored }) => {
    const kv = createKV({ stored });

    await expect(claim(kv)).resolves.toBe(true);
    expect(kv.store.get(KEY)).toBe(NOW.toISOString());
  });

  // A clock skew or a bad write must not park the task past a date it can never reach.
  test("claims when the stamp is dated in the future", async () => {
    const kv = createKV({ stored: new Date(NOW.getTime() + 60 * 60_000).toISOString() });

    await expect(claim(kv)).resolves.toBe(true);
    expect(kv.store.get(KEY)).toBe(NOW.toISOString());
  });

  test("claims when the stamp cannot be read", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const kv = createKV({ readError: new Error("kv unavailable") });

    await expect(claim(kv)).resolves.toBe(true);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  // The TTL must outlive the interval, or the stamp could vanish while the task is still paced and
  // shorten its cadence. Above the interval, expiry can only ever mean the run was already due.
  test("stamps with a TTL that outlives the interval", async () => {
    const kv = createKV();

    await expect(claim(kv)).resolves.toBe(true);

    const options = kv.put.mock.calls[0]?.[2];
    expect(options?.expirationTtl).toBeGreaterThan(INTERVAL_MINUTES * 60);
  });

  test("keys the stamp per task, so two paced tasks cannot share a cadence", async () => {
    const kv = createKV({ stored: NOW.toISOString() });

    await expect(claim(kv)).resolves.toBe(false);
    await expect(claimPacedRun({
      kv: kv as unknown as KVNamespace,
      task: "billing",
      now: NOW,
      intervalMinutes: INTERVAL_MINUTES,
    })).resolves.toBe(true);
  });
});
