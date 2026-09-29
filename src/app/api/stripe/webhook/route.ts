import "server-only";

import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { handleStripeEvent, STRIPE_EVENT_RESULT } from "@/utils/stripe-webhook-handler";
import { recordSpanException, withSpan } from "@/utils/trace";

// Never put the payload, customer ids, or amounts on the span. The event type is a fixed catalog.
const WEBHOOK_SPAN_NAME = "app.stripe.webhook";
const EVENT_TYPE_ATTRIBUTE = "app.stripe.event_type";
const OUTCOME_ATTRIBUTE = "app.stripe.outcome";

// Stripe webhook endpoint. Unauthenticated (Stripe calls it directly) — do NOT wrap in
// auth/CSRF/rate-limit middleware. Signature verification is the auth boundary.
export async function POST(request: Request): Promise<Response> {
  // The span covers the whole body, so a refused signature is visible next to handler failures.
  return withSpan({
    name: WEBHOOK_SPAN_NAME,
    run: (span) => handleWebhook({ request, span }),
  });
}

async function handleWebhook({ request, span }: { request: Request; span: Span }): Promise<Response> {
  // Only a template with NO Stripe config may no-op. A partial config (keys set but
  // webhook secret missing) must fall through to the 400 below so Stripe reports
  // failed deliveries instead of silently dropping lifecycle events.
  const hasAnyStripeConfig = Boolean(
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  );
  if (!hasAnyStripeConfig) {
    span.setAttribute(OUTCOME_ATTRIBUTE, WEBHOOK_OUTCOME.NOT_CONFIGURED);
    return new Response(null, { status: 200 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");

  if (!secret || !signature) {
    span.setAttribute(OUTCOME_ATTRIBUTE, WEBHOOK_OUTCOME.BAD_REQUEST);
    return new Response("Bad request", { status: 400 });
  }

  // RAW body is required for signature verification — never request.json() here.
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = await (await getStripe()).webhooks.constructEventAsync(
      body,
      signature,
      secret,
      undefined,
      // Workers-compatible crypto — the synchronous constructEvent() uses Node crypto
      // and does not run on Cloudflare Workers.
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (error) {
    // A refused signature is an expected 400, so the outcome records it, not an exception.
    console.error("Stripe webhook signature verification failed", error);
    span.setAttribute(OUTCOME_ATTRIBUTE, WEBHOOK_OUTCOME.BAD_SIGNATURE);
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  span.setAttribute(EVENT_TYPE_ATTRIBUTE, event.type);

  try {
    const result = await handleStripeEvent(event);
    span.setAttribute(OUTCOME_ATTRIBUTE, result);
  } catch (error) {
    console.error("Stripe webhook handler failed", { type: event.type, error });
    recordSpanException({ span, error });
    span.setAttribute(OUTCOME_ATTRIBUTE, WEBHOOK_OUTCOME.HANDLER_ERROR);
    // 500 tells Stripe to retry; our handlers are idempotent so retries are safe.
    return new Response("Webhook handler error", { status: 500 });
  }

  return new Response(null, { status: 200 });
}

// Every value of `app.stripe.outcome`: the handler's own results, plus the answers this route gives.
const WEBHOOK_OUTCOME = {
  ...STRIPE_EVENT_RESULT,
  BAD_REQUEST: "bad_request",
  BAD_SIGNATURE: "bad_signature",
  HANDLER_ERROR: "handler_error",
  NOT_CONFIGURED: "not_configured",
} as const;
