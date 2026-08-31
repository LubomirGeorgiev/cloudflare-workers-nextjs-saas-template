import "server-only";

import { revalidatePath } from "next/cache";

import { ADMIN_TEAMS_PATH, ADMIN_USERS_PATH } from "@/constants";

// Which admin pages a write invalidates, in one place rather than one rule per action file. The
// team and user surfaces overlap — a membership and a team-scoped API key each render on both, and
// either page can act on one — so the rule has to be the same whichever door the write came through.
//
// These pages are dynamic behind `requireAdmin`, so a full reload is always fresh; what goes stale
// without this is the acting admin's client router cache.

export function revalidateAdminUser(userId: string): void {
  revalidatePath(`${ADMIN_USERS_PATH}/${userId}`);
}

// The listing carries each team's member count and preview faces, so it goes stale with the page.
export function revalidateAdminTeam(teamId: string): void {
  revalidatePath(`${ADMIN_TEAMS_PATH}/${teamId}`);
  revalidatePath(ADMIN_TEAMS_PATH);
}

/** A membership or a team-scoped API key: both pages list it, either page can act on it. */
export function revalidateAdminTeamAndUser({
  teamId,
  userId,
}: {
  teamId: string | null;
  userId: string;
}): void {
  if (teamId) {
    revalidateAdminTeam(teamId);
  }

  revalidateAdminUser(userId);
}
