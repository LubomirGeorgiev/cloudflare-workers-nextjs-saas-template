import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import {
  clickAppRole,
  expectAppPathname,
  expectAppPathnameNot,
  expectAppPathnameStartsWith,
  expectAppText,
  expectAppToast,
  expectNoAppText,
  fillAppPlaceholder,
  getAppCurrentPathname,
  getAppCurrentUrl,
  loadAppFrame,
  navigateAppFrame,
} from "./app-frame";
import {
  createVerifiedUserInLocalD1,
  SEEDED_USER_PASSWORD,
  signInWithPassword,
} from "./auth-helpers";
import {
  queryLocalD1,
  sqlStringLiteral,
  waitForLocalEmailUrl,
} from "./local-wrangler-state";
import teamPlanCatalog from "../../src/constants/plans.json";

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;

// Derived from the plan catalog so the invite test stays correct if a downstream template
// changes seat limits: pick whichever plan grants the most seats to guarantee headroom.
const planWithMostSeats = Object.entries(
  teamPlanCatalog.plans as Record<string, { limits: { seats: number } }>
).reduce(
  (best, [id, plan]) => (plan.limits.seats > best.seats ? { id, seats: plan.limits.seats } : best),
  { id: "free", seats: 0 }
);

function uniqueSuffix(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

async function seedPendingInvitation({
  email,
  invitedBy,
  rawToken,
  teamId,
  expiresInSeconds = SEVEN_DAYS_IN_SECONDS,
}: {
  email: string;
  invitedBy: string;
  rawToken: string;
  teamId: string;
  expiresInSeconds?: number;
}): Promise<void> {
  const now = Math.floor(Date.now() / 1_000);
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  await queryLocalD1({
    sql: `
      insert into team_invitation (
        id,
        createdAt,
        updatedAt,
        updateCounter,
        teamId,
        email,
        roleId,
        isSystemRole,
        token,
        invitedBy,
        expiresAt,
        acceptedAt,
        acceptedBy
      )
      values (
        ${sqlStringLiteral(`tinv_e2e_${uniqueSuffix()}`)},
        ${now},
        ${now},
        0,
        ${sqlStringLiteral(teamId)},
        ${sqlStringLiteral(email)},
        'member',
        1,
        ${sqlStringLiteral(tokenHash)},
        ${sqlStringLiteral(invitedBy)},
        ${now + expiresInSeconds},
        null,
        null
      );
    `,
  });
}

interface OwnerAndTeam {
  ownerEmail: string;
  ownerId: string;
  teamId: string;
  teamName: string;
  teamPathname: string;
}

// Creates a verified owner (seeded), signs them in, and creates a fresh team through the real
// UI so each test owns an isolated team fixture without cross-test dependencies.
async function createOwnerAndTeam({ label }: { label: string }): Promise<OwnerAndTeam> {
  const suffix = uniqueSuffix();
  const ownerEmail = `team-owner-${label}-${suffix}@example.com`;
  const teamName = `E2E ${label} ${suffix}`;
  const teamPathname = `/dashboard/teams/${teamName.toLowerCase().replaceAll(" ", "-")}`;

  await createVerifiedUserInLocalD1({
    email: ownerEmail,
    firstName: "Team",
    lastName: "Owner",
  });

  await signInWithPassword({
    email: ownerEmail,
    password: SEEDED_USER_PASSWORD,
    redirectPath: "/dashboard/teams/create",
  });

  await navigateAppFrame("/dashboard/teams/create", { waitForHydration: true });
  await fillAppPlaceholder("Enter team name", teamName);
  await fillAppPlaceholder("Enter a brief description of your team", "E2E team fixture.");
  await clickAppRole("button", "Create Team");
  await expectAppPathname(teamPathname);

  const teamId = await queryLocalD1({
    sql: `select id from team where slug = ${sqlStringLiteral(teamPathname.split("/").at(-1)!)};`,
  });
  const ownerId = await queryLocalD1({
    sql: `select userId from team_membership where teamId = ${sqlStringLiteral(teamId)} and roleId = 'owner';`,
  });

  return { ownerEmail, ownerId, teamId, teamName, teamPathname };
}

// A fresh team is on the Free plan (1 seat, filled by the owner), so inviting anyone is
// correctly seat-capped. Grant an active paid subscription to the highest-seat plan to open
// headroom without touching Stripe. Entitlements are read straight from these team columns.
async function grantTeamSeatHeadroom({
  teamId,
  planId,
}: {
  teamId: string;
  planId: string;
}): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1_000);
  const farFutureSec = nowSec + 365 * 24 * 60 * 60;

  await queryLocalD1({
    sql: `update team set subscriptionPlanId = ${sqlStringLiteral(planId)}, subscriptionStatus = 'active', planExpiresAt = ${farFutureSec}, updatedAt = ${nowSec} where id = ${sqlStringLiteral(teamId)};`,
  });
}

async function countTeamMembershipsByEmail({
  teamId,
  email,
}: {
  teamId: string;
  email: string;
}): Promise<number> {
  const output = await queryLocalD1({
    sql: `select count(*) from team_membership tm join user u on u.id = tm.userId where tm.teamId = ${sqlStringLiteral(teamId)} and u.email = ${sqlStringLiteral(email)};`,
  });

  return Number(output);
}

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

  await fillAppPlaceholder("Enter team name", teamName);
  await fillAppPlaceholder("Enter a brief description of your team", description);
  await clickAppRole("button", "Create Team");

  await expectAppPathnameNot("/dashboard/teams/create");
  await expectAppPathnameStartsWith("/dashboard/teams/");
  expect(getAppCurrentPathname()).toBe(expectedTeamPathname);
  await expectAppText(teamName, { exact: true });
  await expectAppText(description, { exact: true });
  await expectAppText("Team Members", { exact: true });
  await expectAppText(email, { exact: true });
  await expectAppText("owner", { exact: true });

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

  await navigateAppFrame(expectedTeamPathname);
  await expectAppText("Pending Team Invitations", { exact: true });
  await expectAppText(inviteeEmail, { exact: true });
  await expectAppText("Expires", { exact: true });
  await expectAppText("Pending", { exact: true });

  await clickAppRole("button", `Revoke invitation for ${inviteeEmail}`, { exact: true });
  await clickAppRole("button", "Revoke invitation", { exact: true });
  await expectAppText("Invitation revoked successfully", { exact: true });
  await expectNoAppText(inviteeEmail, { exact: true });
  await expectNoAppText("Pending Team Invitations", { exact: true });

  const teamPathname = getAppCurrentPathname();
  expect(teamPathname).toBe(expectedTeamPathname);

  await navigateAppFrame("/dashboard/teams", { waitForHydration: true });

  await expectAppText("My Teams", { exact: true });
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
}, 30_000);

// Skipped only if a downstream template collapses every plan to a single seat, which would
// make inviting anyone impossible by design.
test.skipIf(planWithMostSeats.seats < 2)("invites a member through the modal and lists the pending invitation", async () => {
  const { teamId, teamPathname } = await createOwnerAndTeam({ label: "InviteUI" });
  const inviteeEmail = `ui-invitee-${uniqueSuffix()}@example.com`;

  await grantTeamSeatHeadroom({ teamId, planId: planWithMostSeats.id });

  await clickAppRole("button", "Invite Members");
  await fillAppPlaceholder("colleague@example.com", inviteeEmail);
  await clickAppRole("button", "Send Invitation");
  await expectAppToast("Invitation sent successfully");

  // The pending list is server-rendered, so reload to assert it deterministically after refresh.
  await navigateAppFrame(teamPathname, { waitForHydration: true });
  await expectAppText("Pending Team Invitations", { exact: true });
  await expectAppText(inviteeEmail, { exact: true });
  await expectAppText("Pending", { exact: true });

  const pendingCount = await queryLocalD1({
    sql: `select count(*) from team_invitation where teamId = ${sqlStringLiteral(teamId)} and email = ${sqlStringLiteral(inviteeEmail)} and acceptedAt is null;`,
  });
  expect(Number(pendingCount)).toBe(1);
}, 30_000);

test("lets an unregistered invitee sign up, verify, and accept the invitation", async () => {
  const { teamId, teamName, teamPathname, ownerId } = await createOwnerAndTeam({
    label: "Unregistered",
  });
  const inviteeEmail = `unregistered-invitee-${uniqueSuffix()}@example.com`;
  const rawToken = `unregistered-accept-${uniqueSuffix()}`;
  const inviteReturnPath = `/team-invite?token=${encodeURIComponent(rawToken)}`;

  await seedPendingInvitation({ email: inviteeEmail, invitedBy: ownerId, rawToken, teamId });

  // A signed-out invitee is handed off to sign-in with the invite return URL preserved.
  await loadAppFrame(inviteReturnPath, { waitForHydration: true });
  await expectAppPathname("/sign-in");
  const redirectParam = new URL(getAppCurrentUrl()).searchParams.get("redirect");
  expect(redirectParam).toContain("/team-invite");
  expect(redirectParam).toContain(rawToken);

  // The invitee has no account yet, so they register through the real sign-up UI.
  await loadAppFrame("/sign-up?redirect=%2Fdashboard", { waitForHydration: true });
  await fillAppPlaceholder("Email address", inviteeEmail);
  await fillAppPlaceholder("First Name", "Unregistered");
  await fillAppPlaceholder("Last Name", "Invitee");
  await fillAppPlaceholder("Password", "correct horse battery staple");
  await clickAppRole("button", "Create Account with Password");
  await expectAppPathname("/dashboard");

  // Acceptance requires a verified email, so complete verification before following the link.
  const verificationUrl = await waitForLocalEmailUrl({
    email: inviteeEmail,
    pathname: "/verify-email",
  });
  await navigateAppFrame(`${verificationUrl.pathname}${verificationUrl.search}`);
  await expectAppToast("Email verified successfully");

  // Following the invite link now accepts and lands the new member on the team page.
  await navigateAppFrame(inviteReturnPath);
  await expectAppPathname(teamPathname);
  await expectAppText(teamName, { exact: true });

  expect(await countTeamMembershipsByEmail({ teamId, email: inviteeEmail })).toBe(1);
}, 40_000);

test("rejects invitation acceptance for expired tokens and mismatched emails", async () => {
  const { teamId, ownerId } = await createOwnerAndTeam({ label: "Rejections" });
  const matchingEmail = `matching-invitee-${uniqueSuffix()}@example.com`;

  await createVerifiedUserInLocalD1({
    email: matchingEmail,
    firstName: "Matching",
    lastName: "Invitee",
  });

  // Expired invitation addressed to the signed-in user: acceptance surfaces the expiry error.
  const expiredToken = `expired-token-${uniqueSuffix()}`;
  await seedPendingInvitation({
    email: matchingEmail,
    invitedBy: ownerId,
    rawToken: expiredToken,
    teamId,
    expiresInSeconds: -60,
  });

  await signInWithPassword({ email: matchingEmail, password: SEEDED_USER_PASSWORD });
  await navigateAppFrame(`/team-invite?token=${encodeURIComponent(expiredToken)}`);
  await expectAppText("Invitation Error", { exact: true });
  await expectAppText("Invitation has expired");

  // Valid invitation addressed to a different email: the signed-in user is rejected.
  const otherEmail = `other-invitee-${uniqueSuffix()}@example.com`;
  const mismatchToken = `mismatch-token-${uniqueSuffix()}`;
  await seedPendingInvitation({
    email: otherEmail,
    invitedBy: ownerId,
    rawToken: mismatchToken,
    teamId,
  });

  await navigateAppFrame(`/team-invite?token=${encodeURIComponent(mismatchToken)}`);
  await expectAppText("Invitation Error", { exact: true });
  await expectAppText("This invitation is for a different email address");

  // Neither rejected acceptance created a membership for the signed-in user.
  expect(await countTeamMembershipsByEmail({ teamId, email: matchingEmail })).toBe(0);
}, 30_000);
