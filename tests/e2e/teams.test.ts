import { expect, test } from "vitest";
import {
  clickAppRole,
  expectAppPathnameNot,
  expectAppPathnameStartsWith,
  expectAppText,
  fillAppPlaceholder,
  getAppCurrentPathname,
  loadAppFrame,
  navigateAppFrame,
} from "./app-frame";
import {
  listLocalKVEntries,
  queryLocalD1,
  sqlStringLiteral,
} from "./local-wrangler-state";

async function readUserIdFromLocalD1(email: string): Promise<string | undefined> {
  const output = await queryLocalD1({
    sql: `select id from user where email = ${sqlStringLiteral(email)} limit 1;`,
  }).catch(() => "");

  return output || undefined;
}

async function waitForVerificationUrl({
  email,
}: {
  email: string;
}): Promise<URL> {
  const timeoutAt = Date.now() + 5_000;

  while (Date.now() < timeoutAt) {
    const userId = await readUserIdFromLocalD1(email);

    if (userId) {
      for (const { key, value } of await listLocalKVEntries({ prefix: "email-verification:" })) {
        try {
          const payload = JSON.parse(value) as { userId?: string };

          if (payload.userId === userId) {
            return new URL(`/verify-email?token=${key.replace("email-verification:", "")}`, "http://localhost");
          }
        } catch {
          continue;
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for verification URL.");
}

test("creates a team and persists it in the authenticated teams flow", async () => {
  const email = `team-owner-${Date.now()}@example.com`;
  const teamName = `E2E Launch Squad ${Date.now()}`;
  const description = "Owns the launch checklist for the e2e suite.";

  await loadAppFrame("/sign-up?redirect=%2Fdashboard%2Fteams%2Fcreate", {
    waitForHydration: true,
  });

  await fillAppPlaceholder("Email address", email);
  await fillAppPlaceholder("First Name", "Team");
  await fillAppPlaceholder("Last Name", "Owner");
  await fillAppPlaceholder("Password", "password");
  await clickAppRole("button", "Create Account with Password");

  const verificationUrl = await waitForVerificationUrl({
    email,
  });

  await navigateAppFrame(`${verificationUrl.pathname}${verificationUrl.search}`);

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
}, 20_000);
