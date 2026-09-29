import "server-only";

import { tracing } from "cloudflare:workers";

// Name spans `app.<area>.<operation>` and put the result in `app.<area>.outcome`. Attribute values
// stay low-cardinality and never hold user data, URLs, or error text; the runtime already records URLs.

// Workers ends a span when the returned promise settles, but it records no exception on its own.
// `isExpected` marks a throw that is an answer (a refusal, a limit, a redirect), not a fault.
export function withSpan<T>({
  name,
  run,
  isExpected,
}: {
  name: string;
  run: (span: Span) => Promise<T>;
  isExpected?: (error: unknown) => boolean;
}): Promise<T> {
  return tracing.enterSpan(name, async (span) => {
    try {
      return await run(span);
    } catch (error) {
      if (!isExpected?.(error)) {
        recordSpanException({ span, error });
      }
      throw error;
    }
  });
}

export function recordSpanException({ span, error }: { span: Span; error: unknown }): void {
  span.recordException(
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : String(error),
  );
}
