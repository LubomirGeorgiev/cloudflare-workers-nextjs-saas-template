import "server-only";

import type { Route } from "next";
import { headers } from "next/headers";
import { redirect as nextRedirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { REDIRECT_AFTER_SIGN_IN, SITE_URL } from "@/constants";
import { redirect } from "@/i18n/navigation";
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

// Authed sections (`/dashboard`, `/settings`) live outside `[locale]`, so plain
// `redirect("/sign-in")` drops the active locale prefix. Builds the `redirect`
// query param itself — the sign-in page only honors `?redirect=`.
export async function redirectToSignIn(returnTo?: string): Promise<never> {
  const locale = await getLocale();
  const href = returnTo
    ? `/sign-in?redirect=${encodeURIComponent(returnTo)}`
    : "/sign-in";
  return redirect({ href, locale });
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
    // Destination is typically `/dashboard` (outside `[locale]`); keep unprefixed.
    return nextRedirect(redirectPath);
  }

  return session;
}
