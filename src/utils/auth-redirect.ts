import "server-only";

import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { REDIRECT_AFTER_SIGN_IN, SITE_URL } from "@/constants";
import { getSessionFromCookie } from "@/utils/auth";
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
  const requestHeaders = await headers();
  const acceptHeader = requestHeaders.get("accept") ?? "";
  const isRscRequest =
    requestHeaders.get("rsc") === "1" ||
    requestHeaders.has("next-router-state-tree") ||
    acceptHeader.includes("text/x-component");
  const isServerActionRequest = requestHeaders.has("next-action") || isRscRequest;

  if (session && !isServerActionRequest && (!shouldRedirect || shouldRedirect(session))) {
    return redirect(redirectPath);
  }

  return session;
}
