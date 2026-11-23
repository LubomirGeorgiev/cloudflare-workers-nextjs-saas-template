import "server-only";

import { runInBackground } from "@/utils/run-in-background";
import { withSpan } from "@/utils/trace";

const SPAN_NAME = "app.kv.soft_write";
const OPERATION_ATTRIBUTE = "app.kv.operation";
const OUTCOME_ATTRIBUTE = "app.kv.outcome";
const FAILURE_MESSAGE = "KV write failed";

// Workers KV states the HTTP status in the error message, for example "KV PUT failed: 429 ...".
const KV_STATUS_PATTERN = /^KV \w+ failed: (\d{3})\b/;
const RATE_LIMITED_STATUS = "429";

const SOFT_WRITE_OUTCOME = {
  OK: "ok",
  RATE_LIMITED: "rate_limited",
  UPSTREAM_ERROR: "upstream_error",
} as const;

/**
 * Starts a KV write now and lets the request go on without it. A failure never reaches the caller,
 * but it logs one line and sets the span outcome. `operation` must be a fixed name, never user data.
 */
export function writeKvInBackground(args: SoftKvWrite): void {
  runInBackground(writeKvOrLog(args));
}

/** Like `writeKvInBackground`, but the caller waits until the write lands or fails. */
export function writeKvOrLog({ operation, write }: SoftKvWrite): Promise<void> {
  return withSpan({
    name: SPAN_NAME,
    run: async (span) => {
      span.setAttribute(OPERATION_ATTRIBUTE, operation);
      try {
        await write();
        span.setAttribute(OUTCOME_ATTRIBUTE, SOFT_WRITE_OUTCOME.OK);
      } catch (error) {
        const statusCode = readKvStatusCode(error);
        const outcome = isKvRateLimitError(error)
          ? SOFT_WRITE_OUTCOME.RATE_LIMITED
          : SOFT_WRITE_OUTCOME.UPSTREAM_ERROR;
        const errorName = error instanceof Error ? error.name : "unknown";

        span.setAttribute(OUTCOME_ATTRIBUTE, outcome);
        // Provider text can carry the key, and a rate-limit key can hold an IP. So the log and the
        // span get a fixed message, and the span gets no stack, because a stack repeats the message.
        span.recordException({ name: errorName, message: FAILURE_MESSAGE });
        console.error(JSON.stringify({
          message: FAILURE_MESSAGE,
          provider: "kv",
          operation,
          outcome,
          statusCode,
          errorName,
        }));
      }
    },
  });
}

/** True when KV refused a write with 429: one key takes about 1 write per second. */
export function isKvRateLimitError(error: unknown): boolean {
  return readKvStatusCode(error) === RATE_LIMITED_STATUS;
}

function readKvStatusCode(error: unknown): string | null {
  return error instanceof Error ? (KV_STATUS_PATTERN.exec(error.message)?.[1] ?? null) : null;
}

interface SoftKvWrite {
  operation: string;
  write: () => Promise<unknown>;
}
