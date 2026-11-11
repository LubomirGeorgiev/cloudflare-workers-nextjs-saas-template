import type { Route } from "next";

import { TEAMS_DASHBOARD_PATH } from "@/constants";

interface TeamRef {
  id: string;
  slug: string;
}

interface GetActiveTeamParams<T extends TeamRef> {
  teams: T[];
  teamSlug?: string;
  selectedTeamId?: string;
}

interface GetSwitchedTeamPathParams {
  pathname: string;
  currentTeamSlug: string;
  nextTeamSlug: string;
}

// The team in the URL wins over the session selection, so every team control acts on the page's team.
export function getActiveTeam<T extends TeamRef>({
  teams,
  teamSlug,
  selectedTeamId,
}: GetActiveTeamParams<T>): T | undefined {
  return (
    (teamSlug ? teams.find((team) => team.slug === teamSlug) : undefined) ??
    teams.find((team) => team.id === selectedTeamId) ??
    teams[0]
  );
}

export function getTeamSectionPath({ teamSlug, section }: { teamSlug: string; section?: string }): Route {
  const teamPath = `${TEAMS_DASHBOARD_PATH}/${teamSlug}`;

  return section ? `${teamPath}/${section}` : teamPath;
}

// Keep only the first section segment: deeper segments are record IDs that do not exist in the next team.
export function getSwitchedTeamPath({
  pathname,
  currentTeamSlug,
  nextTeamSlug,
}: GetSwitchedTeamPathParams): Route {
  const currentTeamPath = getTeamSectionPath({ teamSlug: currentTeamSlug });
  const rest = pathname.startsWith(`${currentTeamPath}/`)
    ? pathname.slice(currentTeamPath.length + 1)
    : "";
  const section = rest.split("/")[0] || undefined;

  return getTeamSectionPath({ teamSlug: nextTeamSlug, section });
}
