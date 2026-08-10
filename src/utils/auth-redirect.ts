import "server-only";

import type { Route } from "next";
import { headers } from "next/headers";
import { getLocale } from "next-intl/server";

import { REDIRECT_AFTER_SIGN_IN, SITE_URL, TEAMS_DASHBOARD_PATH } from "@/constants";
import { redirect } from "@/i18n/navigation";
import { getCurrentSession, requireAdmin } from "@/utils/auth";
import type { CurrentSession, SessionValidationResult } from "@/types";

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

// Every page lives under `[locale]`, so a plain `redirect` would drop the active locale prefix.
// Builds the `redirect` query param itself — the sign-in page only honors `?redirect=`.
export async function redirectToSignIn(returnTo?: string): Promise<never> {
  const locale = await getLocale();
  const href = returnTo
    ? `/sign-in?redirect=${encodeURIComponent(returnTo)}`
    : "/sign-in";
  return redirect({ href, locale });
}

// Admin pages take the non-throwing guard and redirect home instead: a thrown ActionError
// would render as a 500, not as "this area is for admins".
export async function requireAdminOrRedirectHome(): Promise<CurrentSession> {
  const session = await requireAdmin({ doNotThrowError: true });

  if (!session) {
    return redirect({ href: "/", locale: await getLocale() });
  }

  return session;
}

// Team sections live at /dashboard/teams/[teamSlug]/<section>. Thin nav routes like
// /dashboard/billing stay team-agnostic by resolving the session's selected team here.
export async function redirectToSelectedTeamPage(section: string): Promise<never> {
  const session = await getCurrentSession();
  if (!session) {
    return redirectToSignIn(`/dashboard/${section}`);
  }

  const locale = await getLocale();
  const teams = session.teams ?? [];
  const selectedTeam = teams.find((team) => team.id === session.selectedTeam) ?? teams[0];
  if (!selectedTeam) {
    redirect({ href: TEAMS_DASHBOARD_PATH, locale });
  }

  return redirect({ href: `${TEAMS_DASHBOARD_PATH}/${selectedTeam.slug}/${section}`, locale });
}

export async function redirectAuthenticatedUser({
  redirectPath,
  shouldRedirect,
}: RedirectAuthenticatedUserParams): Promise<SessionValidationResult> {
  const session = await getCurrentSession();
  const requestHeaders = await headers();
  const acceptHeader = requestHeaders.get("accept") ?? "";
  const isRscRequest =
    requestHeaders.get("rsc") === "1" ||
    requestHeaders.has("next-router-state-tree") ||
    acceptHeader.includes("text/x-component");
  const isServerActionRequest = requestHeaders.has("next-action") || isRscRequest;

  if (session && !isServerActionRequest && (!shouldRedirect || shouldRedirect(session))) {
    return redirect({ href: redirectPath, locale: await getLocale() });
  }

  return session;
}
