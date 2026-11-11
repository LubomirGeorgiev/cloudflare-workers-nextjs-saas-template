import type { Route } from "next";

import { TEAM_INVITE_PATH } from "@/constants";
import { stripLocalePrefix } from "@/i18n/locale-prefix";

export function getTeamInvitePath(token: string): Route {
  return `${TEAM_INVITE_PATH}?token=${encodeURIComponent(token)}` as Route;
}

// Sign-in keeps the invite as its return path, so the accept step runs after authentication.
export function getTeamInviteSignInPath(token: string): Route {
  return `/sign-in?redirect=${encodeURIComponent(getTeamInvitePath(token))}` as Route;
}

export function isTeamInviteRedirect(redirectPath: string): boolean {
  const pathname = redirectPath.split(/[?#]/)[0];

  return (stripLocalePrefix(pathname) ?? pathname) === TEAM_INVITE_PATH;
}
