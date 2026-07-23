import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";

import { getTeamBySlug } from "@/lib/teams/teams";
import { hasTeamMembership } from "@/utils/team-auth";
import { getSessionFromCookie } from "@/utils/auth";
import { redirectToSignIn } from "@/utils/auth-redirect";

// Single authorization point for the /dashboard/teams/[teamSlug] routes: resolves the team
// and the authenticated session together, but only when the current user is an active
// member. Authenticated non-members 404 so the response never confirms the team exists or
// leaks its name. React.cache dedupes the lookup so generateMetadata and the page body share
// one resolution per request.
export const requireTeamAccess = cache(async (teamSlug: string) => {
  // Anonymous visitors belong at sign-in, not a 404. Check session presence BEFORE resolving
  // the team so an anonymous request redirects regardless of whether the slug exists — otherwise
  // a redirect-vs-404 difference would leak team existence to signed-out users. Anti-enumeration
  // only requires hiding teams from authenticated non-members, handled by the 404 below.
  const cookieSession = await getSessionFromCookie();
  if (!cookieSession) {
    await redirectToSignIn(`/dashboard/teams/${teamSlug}`);
  }

  const team = await getTeamBySlug(teamSlug);
  if (!team) {
    notFound();
  }

  const { hasAccess, session } = await hasTeamMembership(team.id);
  if (!hasAccess || !session) {
    notFound();
  }

  return { team, session };
});
