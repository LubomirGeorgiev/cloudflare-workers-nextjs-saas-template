import "server-only";

import type { ActionServerError } from "@/lib/safe-action";
import { redirectToSignIn } from "@/utils/auth-redirect";

// The one `ActionError` code that actually means "your session is gone". Every other failure a
// server action can report is a different problem wearing the same envelope.
const UNAUTHENTICATED_ERROR_CODE = "NOT_AUTHORIZED";

interface PageActionResult<T> {
  data?: T;
  serverError?: ActionServerError;
}

type PageActionOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

/**
 * Unwraps a server action awaited during a page render.
 *
 * Only a genuinely unauthenticated caller is sent to sign-in — reporting anything else as "signed
 * out" bounces a user with a perfectly good session to `/sign-in`. Every other failure is handed
 * back for the page to render: throwing would reach the error boundary with its message stripped
 * in production, and the message (a rate limit's retry window, say) is the whole point.
 */
export async function resolvePageAction<T>(
  result: PageActionResult<T>,
): Promise<PageActionOutcome<T>> {
  if (result.serverError?.code === UNAUTHENTICATED_ERROR_CODE) {
    return redirectToSignIn();
  }

  if (result.serverError) {
    return { ok: false, code: result.serverError.code, message: result.serverError.message };
  }

  // Not a user-facing state: an action either resolves with data or reports why it could not.
  // Let the boundary have it rather than inventing copy for a case that means we have a bug.
  if (result.data === undefined) {
    throw new Error("Server action resolved without data or an error.");
  }

  return { ok: true, data: result.data };
}
