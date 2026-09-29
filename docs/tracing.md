# Tracing

How the Worker opens custom spans, names them, and records their result. The Workers runtime
already traces each invocation, each binding call, and each outbound `fetch`. A custom span adds
the one fact that the runtime cannot know: what the app decided.

## One helper

Open a span only with `withSpan` from `src/utils/trace.ts`. Never call `tracing.enterSpan` from
`cloudflare:workers` directly.

The runtime ends a span when the returned promise settles, but it records no exception on its own.
`withSpan` catches a throw, records it as a span exception, and rethrows it. A direct call to
`enterSpan` skips that step, so a fault shows as a normal span.

## Names and attributes

- Name a span `app.<area>.<operation>`. Examples: `app.request`, `app.action`,
  `app.api.operation`, `app.api.auth`, `app.auth.session.validate`, `app.ratelimit.charge`,
  `app.scheduler.maintenance`, `app.stripe.webhook`.
- Put the span name and the attribute keys in constants at the top of the module.
- Put the result in `app.<area>.outcome`, for example `app.api.auth.outcome`,
  `app.auth.session.outcome`, or `app.scheduler.outcome`.
- Write the outcome values as a const object of low-cardinality snake_case strings. Keep that
  object in the module that owns the rule.
- For HTTP and messaging data, use the OpenTelemetry keys: `http.request.method`,
  `http.response.status_code`, `messaging.destination.name`, and `faas.cron`.

The `app.` prefix keeps app spans apart from runtime spans. One outcome key per area lets a query
group all spans of that area by one field. A trace tool reads the OpenTelemetry keys without a map.

## What an attribute may hold

Keep attribute values low-cardinality. Never put user data, ids, emails, URLs, or error text in an
attribute.

Trace data goes to a different store, with different access and retention rules. A key with many
distinct values also makes a group-by useless. The runtime already records the request URL, so a
copy adds nothing. When a value comes from unvalidated input, change an unknown value to one fixed
value. `toKnownValue` in `src/lib/scheduler/worker.ts` maps an unknown job type to `unknown`.

## Answers are not faults

A span exception marks the span as an error in the trace tool. When answers count as errors, the
error rate no longer shows only faults. A refusal, a rate limit, or a redirect is an answer.

When a throw is an answer, pass `isExpected` to `withSpan` and set the outcome attribute.
`withSpan` then records no exception. Examples:

- `src/lib/safe-action.ts`: a redirect.
- `src/api/operation-trace.ts`: an `ActionError` refusal from the guard.
- `src/utils/with-rate-limit.ts`: a `RateLimitError`.

Do not return a sentinel value or rethrow outside the span to hide an expected error. Both change
how the code runs only to change the trace, and a caller can miss a sentinel.

When the code catches an error and answers without a throw, set only the outcome. The Stripe
webhook answers a refused signature with a 400 and sets `bad_signature`. Call `recordSpanException`
only for a real fault that does not leave the span as a throw. Examples: the Stripe handler error
that returns a 500, and a Hono error that `next()` turns into `c.res`.

## What an exception records

Attribute values never hold error text, but a recorded exception carries the full error.
`recordSpanException` records the error name, message, and stack. It records a non-`Error` value as
`String(error)`. The full error is the purpose of an exception event: it tells you what failed and
where.

## Parent and child spans

A parent span that dispatches child tasks reports only its own step. Each child span reports `ok`
or `failed`. The paced scheduler claim span reports `skipped_not_claimed` or `dispatched`, and each
task span reports its own result.

A child failure must never make the parent report the success or failure of the child's work.
Otherwise one failed task shows twice, or a parent `ok` hides it.

## `span.isTraced`

Guard with `span.isTraced` only when the attribute costs real work, such as a table scan or a
lookup. A constant attribute needs no guard: on an untraced span, `setAttribute` does nothing.

## Tests

Unit tests alias `cloudflare:workers` to `tests/fixtures/cloudflare-workers.ts`
(see `vitest.unit.config.ts`). Its span is untraced, so traced code runs and records nothing.

To assert spans, mock `tracing.enterSpan` in `cloudflare:workers` with a fake span. Spread
`importOriginal()` so that the other exports stay. Then run the real `withSpan`, so the `isExpected`
policy is under test. See `src/lib/safe-action.test.ts` or `src/utils/with-rate-limit.test.ts`.

A test that checks only attributes can mock `@/utils/trace` with a pass-through `withSpan`. If a test
checks whether an exception is recorded, run the real `withSpan`. A copy of its policy in a mock can
pass while the real policy is wrong.
