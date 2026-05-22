import "server-only";

import type { Route } from "next";
import { redirect } from "next/navigation";

import { REDIRECT_AFTER_SIGN_IN, SITE_URL } from "@/constants";
import { getSessionFromCookie } from "@/utils/auth";
import { isServerActionRequest } from "@/utils/is-server-action-request";
import type { SessionValidationResult } from "@/types";

interface RedirectAuthenticatedUserParams {
  redirectPath: Route;
  shouldRedirect?: (session: NonNullable<SessionValidationResult>) => boolean;
}

interface SafeRedirectPathParams {
  value?: string;
  fallback?: Route;
}

export function getSafeRedirectPath({
  value,
  fallback = REDIRECT_AFTER_SIGN_IN,
}: SafeRedirectPathParams): Route {
  if (!value || value.startsWith("//")) {
    return fallback;
  }

  try {
    const siteUrl = new URL(SITE_URL);
    const redirectUrl = new URL(value, siteUrl);

    if (redirectUrl.origin !== siteUrl.origin) {
      return fallback;
    }

    return `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}` as Route;
  } catch {
    return fallback;
  }
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
