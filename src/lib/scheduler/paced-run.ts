import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";

// Paces a cron task that must run far less often than the cron ticks. KV holds the last run, so the
// cadence is measured from the task's own history rather than inferred from the cron expression —
// nothing here has to stay in sync with the `crons` entry in `wrangler.jsonc`.

// KV rejects a shorter expiry.
const KV_MINIMUM_TTL_SECONDS = 60;
// How many intervals a stamp outlives. Above one, a running task always rewrites its stamp before
// the TTL can fire, so expiry and "overdue" agree and the TTL can never shorten a cadence. It only
// collects the stamp of a task that stopped running, which nothing else would ever delete.
const PACED_RUN_TTL_INTERVALS = 2;

interface ClaimPacedRunOptions {
  kv: KVNamespace;
  /** Stable name of the paced task; it is the KV key, so renaming one resets its cadence. */
  task: string;
  now: Date;
  intervalMinutes: number;
}

function getPacedRunKey(task: string): string {
  return `${APP_KV_PREFIXES.maintenanceRun}${task}`;
}

// Fails toward running. An unreadable, unparsable, or future-dated stamp leaves the cadence unknown,
// and these sweeps are idempotent and self-bounded, so one extra run costs far less than the silent
// permanent stall that trusting a bad stamp would produce.
async function isPacedRunDue({
  kv,
  key,
  now,
  intervalMinutes,
}: {
  kv: KVNamespace;
  key: string;
  now: Date;
  intervalMinutes: number;
}): Promise<boolean> {
  let stored: string | null = null;

  try {
    stored = await kv.get(key);
  } catch (error) {
    console.error(`claimPacedRun: could not read ${key}`, error);
    return true;
  }

  const lastRunAt = stored ? Date.parse(stored) : Number.NaN;

  if (Number.isNaN(lastRunAt)) {
    return true;
  }

  const elapsedMs = now.getTime() - lastRunAt;

  return elapsedMs >= intervalMinutes * 60 * 1000 || elapsedMs < 0;
}

// Stamps the run BEFORE the caller does the work, never after: a sweep that throws or overruns must
// not let the next tick start it again, because the two would share one subrequest budget. Losing
// an interval is cheap next to that, and every paced sweep here has day-wide deadlines.
export async function claimPacedRun({
  kv,
  task,
  now,
  intervalMinutes,
}: ClaimPacedRunOptions): Promise<boolean> {
  const key = getPacedRunKey(task);

  if (!await isPacedRunDue({ kv, key, now, intervalMinutes })) {
    return false;
  }

  await kv.put(key, now.toISOString(), {
    expirationTtl: Math.max(
      KV_MINIMUM_TTL_SECONDS,
      intervalMinutes * 60 * PACED_RUN_TTL_INTERVALS,
    ),
  });

  return true;
}
