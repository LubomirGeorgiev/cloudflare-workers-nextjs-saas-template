import "server-only";

import { runInBackground } from "@/utils/run-in-background";

// Bounds isolate memory; clearing just allows one early re-stamp per subject.
const MAX_TRACKED_SUBJECTS = 10_000;

interface BackgroundTouch {
  /** Schedules the write unless this isolate already stamped `id` within the interval. */
  touch: (id: string) => void;
  resetForTests: () => void;
}

// Usage stamps (`lastActiveAt`, `lastUsedAt`) are hints, not audit trails. The throttle is per
// isolate, so a cold isolate may add one extra write, and nothing here may fail or delay the
// request that triggered it — the write is scheduled in the background and errors are swallowed.
export function createBackgroundTouch({
  intervalMs,
  write,
}: {
  intervalMs: number;
  write: (args: { id: string; now: Date }) => Promise<unknown>;
}): BackgroundTouch {
  const lastTouchById = new Map<string, number>();

  return {
    touch(id: string): void {
      const now = Date.now();
      const lastTouch = lastTouchById.get(id);

      if (lastTouch !== undefined && now - lastTouch < intervalMs) {
        return;
      }

      // Recorded before the write is scheduled: a failed write must not let the next request
      // through the gate, or a broken D1 would turn every hit into another attempt.
      if (lastTouchById.size >= MAX_TRACKED_SUBJECTS) {
        lastTouchById.clear();
      }
      lastTouchById.set(id, now);

      try {
        runInBackground(write({ id, now: new Date(now) }));
      } catch (error) {
        console.error("Failed to schedule background touch:", error);
      }
    },

    resetForTests(): void {
      lastTouchById.clear();
    },
  };
}
