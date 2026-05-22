import "server-only";

import type { Route } from "next";
import { redirect } from "next/navigation";

import { getSessionFromCookie } from "@/utils/auth";
import { isServerActionRequest } from "@/utils/is-server-action-request";
import type { SessionValidationResult } from "@/types";

interface RedirectAuthenticatedUserParams {
  redirectPath: Route;
  shouldRedirect?: (session: NonNullable<SessionValidationResult>) => boolean;
}

export async function redirectAuthenticatedUser({
  redirectPath,
  shouldRedirect,
}: RedirectAuthenticatedUserParams): Promise<SessionValidationResult> {
  const session = await getSessionFromCookie();
  const isActionRequest = await isServerActionRequest();

  // TODO(vinext): Remove this server-action guard once cloudflare/vinext#654
  // and cloudflare/vinext#1347 are fixed. Auth actions set or update session
  // cookies, then Vinext re-renders auth pages and currently turns redirects
  // into action redirect responses before next-safe-action can finish.
  if (session && !isActionRequest && (!shouldRedirect || shouldRedirect(session))) {
    return redirect(redirectPath);
  }

  return session;
}
