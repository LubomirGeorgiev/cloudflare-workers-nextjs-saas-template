import { expect, test } from "vitest";
import {
  clickAppRole,
  expectAppPathnameNot,
  expectAppPathnameStartsWith,
  expectAppPathname,
  expectAppText,
  expectAppToast,
  expectNoAppText,
  fillAppPlaceholder,
  getAppCurrentPathname,
  navigateAppFrame,
} from "./app-frame";
import { scaleE2ETimeout } from "./e2e-environment.mjs";
import {
  createVerifiedUserInLocalD1,
  SEEDED_USER_PASSWORD,
  signInWithPassword,
} from "./auth-helpers";
import { queryLocalD1, sqlStringLiteral } from "./local-wrangler-state";
import {
  createOwnerAndTeam,
  grantTeamSeatHeadroom,
  planWithMostSeats,
  seedPendingInvitation,
  TEAMS_COPY,
  uniqueSuffix,
} from "./team-helpers";
import { SYSTEM_ROLES_ENUM } from "../../src/constants/team-roles";
import { DEFAULT_LOCALE } from "../../src/i18n/config";
import { getTranslator } from "../../src/i18n/translator";

const formatTeamsCopy = await getTranslator({
  locale: DEFAULT_LOCALE,
  namespace: "Client.Dashboard.Teams",
});

test("creates a team and persists it in the authenticated teams flow", async () => {
  const email = `team-owner-${Date.now()}@example.com`;
  const teamName = `E2E Launch Squad ${Date.now()}`;
  const expectedTeamPathname = `/dashboard/teams/${teamName.toLowerCase().replaceAll(" ", "-")}`;
  const description = "Owns the launch checklist for the e2e suite.";
  const inviteeEmail = `team-invitee-${Date.now()}@example.com`;

  await createVerifiedUserInLocalD1({
    email,
    firstName: "Team",
    lastName: "Owner",
  });

  await signInWithPassword({
    email,
    password: SEEDED_USER_PASSWORD,
    redirectPath: "/dashboard/teams/create",
  });

  await navigateAppFrame("/dashboard/teams/create", {
    waitForHydration: true,
  });

  await fillAppPlaceholder(TEAMS_COPY.formNamePlaceholder, teamName);
  await fillAppPlaceholder(TEAMS_COPY.formDescriptionPlaceholder, description);
  await clickAppRole("button", TEAMS_COPY.createTeam);

  await expectAppPathnameNot("/dashboard/teams/create");
  await expectAppPathnameStartsWith("/dashboard/teams/");
  expect(getAppCurrentPathname()).toBe(expectedTeamPathname);
  await expectAppText(teamName, { exact: true });
  await expectAppText(description, { exact: true });
  await expectAppText(TEAMS_COPY.teamMembers, { exact: true });
  await expectAppText(email, { exact: true });
  // The "your role" card prints the session role id, not a catalog label.
  await expectAppText(SYSTEM_ROLES_ENUM.OWNER, { exact: true });

  const teamId = await queryLocalD1({
    sql: `select id from team where slug = ${sqlStringLiteral(expectedTeamPathname.split("/").at(-1)!)};`,
  });
  const ownerId = await queryLocalD1({
    sql: `select userId from team_membership where teamId = ${sqlStringLiteral(teamId)} and roleId = 'owner';`,
  });
  await seedPendingInvitation({
    email: inviteeEmail,
    invitedBy: ownerId,
    rawToken: `revoke-token-${Date.now()}`,
    teamId,
  });

  await navigateAppFrame(expectedTeamPathname, { waitForHydration: true });
  await expectAppText(TEAMS_COPY.pendingInvitationsTitle, { exact: true });
  await expectAppText(inviteeEmail, { exact: true });
  await expectAppText(TEAMS_COPY.columnExpires, { exact: true });
  await expectAppText(TEAMS_COPY.statusPending, { exact: true });

  await clickAppRole("button", formatTeamsCopy("revokeInvitationFor", { email: inviteeEmail }), {
    exact: true,
  });
  await clickAppRole("button", TEAMS_COPY.revokeInvitation, { exact: true });
  await expectAppText(TEAMS_COPY.toastRevokeInvitationSuccess, { exact: true });
  await expectNoAppText(inviteeEmail, { exact: true });
  await expectNoAppText(TEAMS_COPY.pendingInvitationsTitle, { exact: true });

  const teamPathname = getAppCurrentPathname();
  expect(teamPathname).toBe(expectedTeamPathname);

  await navigateAppFrame("/dashboard/teams", { waitForHydration: true });

  await expectAppText(TEAMS_COPY.title, { exact: true });
  await expectAppText(teamName, { exact: true });

  await navigateAppFrame(teamPathname);

  await expectAppPathnameStartsWith(expectedTeamPathname);
  await expectAppText(teamName, { exact: true });

  await createVerifiedUserInLocalD1({
    email: inviteeEmail,
    firstName: "Invited",
    lastName: "Member",
  });
  const acceptanceToken = `accept-token-${Date.now()}`;
  await seedPendingInvitation({
    email: inviteeEmail,
    invitedBy: ownerId,
    rawToken: acceptanceToken,
    teamId,
  });

  await signInWithPassword({
    email: inviteeEmail,
    password: SEEDED_USER_PASSWORD,
  });
  await navigateAppFrame(`/team-invite?token=${encodeURIComponent(acceptanceToken)}`);
  await expectAppPathname(expectedTeamPathname);
  await expectAppText(teamName, { exact: true });
}, scaleE2ETimeout(30_000));

// Skipped only if a downstream template collapses every plan to a single seat, which would
// make inviting anyone impossible by design.
test.skipIf(planWithMostSeats.seats < 2)("invites a member through the modal and lists the pending invitation", async () => {
  const { teamId, teamPathname } = await createOwnerAndTeam({ label: "InviteUI" });
  const inviteeEmail = `ui-invitee-${uniqueSuffix()}@example.com`;

  await grantTeamSeatHeadroom({ teamId, planId: planWithMostSeats.id });
  await navigateAppFrame(teamPathname, { waitForHydration: true });

  await clickAppRole("button", TEAMS_COPY.inviteMembers);
  await fillAppPlaceholder(TEAMS_COPY.inviteEmailPlaceholder, inviteeEmail);
  await clickAppRole("button", TEAMS_COPY.sendInvitation);
  await expectAppToast(TEAMS_COPY.toastInviteSuccess);

  // The pending list is server-rendered, so reload to assert it deterministically after refresh.
  await navigateAppFrame(teamPathname, { waitForHydration: true });
  await expectAppText(TEAMS_COPY.pendingInvitationsTitle, { exact: true });
  await expectAppText(inviteeEmail, { exact: true });
  await expectAppText(TEAMS_COPY.statusPending, { exact: true });

  const pendingCount = await queryLocalD1({
    sql: `select count(*) from team_invitation where teamId = ${sqlStringLiteral(teamId)} and email = ${sqlStringLiteral(inviteeEmail)} and acceptedAt is null;`,
  });
  expect(Number(pendingCount)).toBe(1);
}, scaleE2ETimeout(30_000));
