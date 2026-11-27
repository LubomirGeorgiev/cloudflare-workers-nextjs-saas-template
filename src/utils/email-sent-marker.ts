import "server-only";

import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";
import { writeKvOrLog } from "@/utils/background-kv-write";
import { getCloudflareContext } from "@/utils/cloudflare-context";

// Longer than Stripe retries a webhook (3 days), so a retry that saves the same job again still skips.
const EMAIL_SENT_MARKER_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Reads the KV marker that `writeEmailSentMarker` writes after a send. The read and the write are
 * no atomic claim: two close dispatches of one job row can both send. The marker is best-effort
 * dedupe that narrows the duplicate window.
 */
export async function readEmailSentMarker(dedupeKey: string): Promise<EmailSentMarker> {
  try {
    const { env } = await getCloudflareContext();

    return (await env.KV_STORE.get(markerKey(dedupeKey))) === null ? EMAIL_SENT_MARKER.MISSING : EMAIL_SENT_MARKER.FOUND;
  } catch (error) {
    // The key holds no address, but the provider text is not logged: a KV error can name other keys.
    console.error(JSON.stringify({
      event: "email_sent_marker_read_failed",
      provider: "kv",
      operation: "get",
      errorName: error instanceof Error ? error.name : "unknown",
    }));
    return EMAIL_SENT_MARKER.READ_FAILED;
  }
}

/** Never throws: a throw makes the queue retry, and the retry sends the email again. */
export async function writeEmailSentMarker(dedupeKey: string): Promise<void> {
  const { env } = await getCloudflareContext();

  await writeKvOrLog({
    operation: "email_sent_marker",
    write: () => env.KV_STORE.put(markerKey(dedupeKey), "1", { expirationTtl: EMAIL_SENT_MARKER_TTL_SECONDS }),
  });
}

/** A failed marker read sends: a second copy of an email is better than no email. */
export function selectEmailSendOutcome(marker: EmailSentMarker): EmailSendOutcome {
  switch (marker) {
    case EMAIL_SENT_MARKER.FOUND:
      return EMAIL_SEND_OUTCOMES.SKIPPED_ALREADY_SENT;
    case EMAIL_SENT_MARKER.READ_FAILED:
      return EMAIL_SEND_OUTCOMES.SENT_MARKER_READ_FAILED;
    case EMAIL_SENT_MARKER.MISSING:
    case EMAIL_SENT_MARKER.NONE:
      return EMAIL_SEND_OUTCOMES.SENT;
  }
}

function markerKey(dedupeKey: string): string {
  return `${APP_KV_PREFIXES.emailSent}${dedupeKey}`;
}

export const EMAIL_SENT_MARKER = {
  // The job came from no D1 row, so no marker applies.
  NONE: "none",
  MISSING: "missing",
  FOUND: "found",
  READ_FAILED: "read_failed",
} as const;

type EmailSentMarker = typeof EMAIL_SENT_MARKER[keyof typeof EMAIL_SENT_MARKER];

export const EMAIL_SEND_OUTCOMES = {
  SENT: "sent",
  SKIPPED_ALREADY_SENT: "skipped_already_sent",
  SENT_MARKER_READ_FAILED: "sent_marker_read_failed",
  UPSTREAM_ERROR: "upstream_error",
} as const;

type EmailSendOutcome = typeof EMAIL_SEND_OUTCOMES[keyof typeof EMAIL_SEND_OUTCOMES];
