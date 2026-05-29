import { expect, test } from "vitest";
import {
  clickAppRole,
  expectAppPathnameNot,
  expectAppPathnameStartsWith,
  expectAppText,
  fillAppPlaceholder,
  getAppCurrentPathname,
  navigateAppFrame,
} from "./app-frame";
import { createVerifiedUserInLocalD1, signInWithPassword } from "./auth-helpers";

test("creates a team and persists it in the authenticated teams flow", async () => {
  const email = `team-owner-${Date.now()}@example.com`;
  const teamName = `E2E Launch Squad ${Date.now()}`;
  const description = "Owns the launch checklist for the e2e suite.";

  await createVerifiedUserInLocalD1({
    email,
    firstName: "Team",
    lastName: "Owner",
  });

  await signInWithPassword({
    email,
    password: "password",
    redirectPath: "/dashboard/teams/create",
  });

  await navigateAppFrame("/dashboard/teams/create", {
    waitForHydration: true,
  });

  await fillAppPlaceholder("Enter team name", teamName);
  await fillAppPlaceholder("Enter a brief description of your team", description);
  await clickAppRole("button", "Create Team");

  await expectAppPathnameNot("/dashboard/teams/create");
  await expectAppPathnameStartsWith("/dashboard/teams/");
  await expectAppText(teamName, { exact: true });
  await expectAppText(description, { exact: true });
  await expectAppText("Team Members", { exact: true });
  await expectAppText(email, { exact: true });
  await expectAppText("owner", { exact: true });

  const teamPathname = getAppCurrentPathname();
  expect(teamPathname).not.toBe("/dashboard/teams/create");

  await navigateAppFrame("/dashboard/teams", { waitForHydration: true });

  await expectAppText("My Teams", { exact: true });
  await expectAppText(teamName, { exact: true });

  await navigateAppFrame(teamPathname);

  await expectAppText(teamName, { exact: true });
}, 15_000);
