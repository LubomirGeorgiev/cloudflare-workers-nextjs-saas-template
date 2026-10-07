import "server-only";

import { env } from "cloudflare:workers";

import {
  CMS_REPURGE_ENTRIES_PER_MESSAGE,
  CMS_REPURGE_PATHNAME_MAX_LENGTH,
  CMS_REPURGE_PATHNAMES_PER_MESSAGE,
  type CmsRepurgeTarget,
  createScheduledQueueMessage,
  SCHEDULED_JOB_TYPES,
} from "@/lib/scheduler/jobs";
import { chunk } from "@/utils/chunk";

// A `sendBatch` call takes at most 256 KB. Three full repurge messages stay below it.
const CMS_REPURGE_MESSAGES_PER_SEND = 3;

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

// Fire-once by design: the job handler runs the purge without a warm and without this enqueue, so a
// delayed purge never schedules another one. The navigations and scopes ride on the first message.
export async function enqueueCmsRepurge({
  entries,
  entryChange,
  knownPagePathnames,
  navigationKeys,
  scopes,
  delaySeconds,
}: CmsRepurgeTarget & { delaySeconds: number }): Promise<void> {
  const runAt = new Date(Date.now() + delaySeconds * 1000);
  // A longer path cannot ride a message. The subtree prefix and the TTL still bound its copy.
  const pathnames = knownPagePathnames.filter(
    (pathname) => pathname.length <= CMS_REPURGE_PATHNAME_MAX_LENGTH,
  );
  const entryParts = chunk({ items: entries, size: CMS_REPURGE_ENTRIES_PER_MESSAGE });
  const pathnameParts = chunk({ items: pathnames, size: CMS_REPURGE_PATHNAMES_PER_MESSAGE });
  const messageCount = Math.max(1, entryParts.length, pathnameParts.length);
  const payloads = Array.from({ length: messageCount }, (__, index) => ({
    entries: entryParts[index] ?? [],
    entryChange,
    knownPagePathnames: pathnameParts[index] ?? [],
    ...(index === 0 ? { navigationKeys, scopes } : {}),
  }));
  const messages = payloads.map((payload) => ({
    body: createScheduledQueueMessage({
      type: SCHEDULED_JOB_TYPES.CMS_REPURGE,
      payload,
      runAt,
    }),
    delaySeconds,
  }));

  for (const batch of chunk({ items: messages, size: CMS_REPURGE_MESSAGES_PER_SEND })) {
    await env.SCHEDULER_QUEUE.sendBatch(batch);
  }
}
