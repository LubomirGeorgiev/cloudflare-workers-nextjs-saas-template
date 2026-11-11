import { describe, expect, test } from "vitest";

import { TEAMS_DASHBOARD_PATH } from "@/constants";
import { getActiveTeam, getSwitchedTeamPath, getTeamSectionPath } from "./active-team";

const teams = [
  { id: "team-a", slug: "alpha" },
  { id: "team-b", slug: "beta" },
  { id: "team-c", slug: "gamma" },
];

describe("getActiveTeam", () => {
  test("prefers the team in the URL over the session selection", () => {
    expect(getActiveTeam({ teams, teamSlug: "gamma", selectedTeamId: "team-b" })?.id).toBe("team-c");
  });

  test("uses the session selection when the URL has no team", () => {
    expect(getActiveTeam({ teams, selectedTeamId: "team-b" })?.id).toBe("team-b");
  });

  test("falls back to the selection when the URL team is not a membership", () => {
    expect(getActiveTeam({ teams, teamSlug: "other", selectedTeamId: "team-b" })?.id).toBe("team-b");
  });

  test("falls back to the first team, and to nothing without teams", () => {
    expect(getActiveTeam({ teams, selectedTeamId: "missing" })?.id).toBe("team-a");
    expect(getActiveTeam({ teams: [], teamSlug: "alpha" })).toBeUndefined();
  });
});

describe("getSwitchedTeamPath", () => {
  const alphaPath = getTeamSectionPath({ teamSlug: "alpha" });

  test("keeps the section and drops deeper record segments", () => {
    expect(getSwitchedTeamPath({
      pathname: `${alphaPath}/billing`,
      currentTeamSlug: "alpha",
      nextTeamSlug: "beta",
    })).toBe(`${TEAMS_DASHBOARD_PATH}/beta/billing`);

    expect(getSwitchedTeamPath({
      pathname: `${alphaPath}/section/record-1`,
      currentTeamSlug: "alpha",
      nextTeamSlug: "beta",
    })).toBe(`${TEAMS_DASHBOARD_PATH}/beta/section`);
  });

  test("opens the team root from the team root", () => {
    expect(getSwitchedTeamPath({
      pathname: alphaPath,
      currentTeamSlug: "alpha",
      nextTeamSlug: "beta",
    })).toBe(`${TEAMS_DASHBOARD_PATH}/beta`);
  });
});
