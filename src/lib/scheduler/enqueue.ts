import "server-only";

import { env } from "cloudflare:workers";

import { createScheduledQueueMessage, SCHEDULED_JOB_TYPES } from "@/lib/scheduler/jobs";

// Refreshing member sessions fans out to D1 + KV work per member — far too slow to run
// inline in a webhook Stripe expects to ack quickly, or in a user-facing action. Offload
// it to the scheduler queue.
export async function enqueueTeamSessionsRefresh(teamId: string): Promise<void> {
  await env.SCHEDULER_QUEUE.send(createScheduledQueueMessage({
    type: SCHEDULED_JOB_TYPES.TEAM_SESSIONS_REFRESH,
    payload: { teamId },
    runAt: new Date(),
  }));
}

// A ban must never be blocked by a Stripe network call, so a failed cancel is retried here
// instead of thrown. The handler is idempotent: re-cancelling an already-cancelled subscription
// is a no-op, and one Stripe no longer knows counts as done.
export async function enqueueBillingCancelSubscription({
  teamId,
  subscriptionId,
}: {
  teamId: string;
  subscriptionId: string;
}): Promise<void> {
  await env.SCHEDULER_QUEUE.send(createScheduledQueueMessage({
    type: SCHEDULED_JOB_TYPES.BILLING_CANCEL_SUBSCRIPTION,
    payload: { teamId, subscriptionId },
    runAt: new Date(),
  }));
}
