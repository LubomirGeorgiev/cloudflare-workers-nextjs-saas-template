import { expect, test } from "vitest";
import {
  clickAppRole,
  expectAppPathname,
  expectAppText,
  expectAppToast,
  fillAppPlaceholder,
  getAppCurrentUrl,
  loadAppFrame,
  navigateAppFrame,
} from "./app-frame";
import { scaleE2ETimeout } from "./e2e-environment.mjs";
import {
  AUTH_COPY,
  createVerifiedUserInLocalD1,
  SEEDED_USER_PASSWORD,
  signInWithPassword,
} from "./auth-helpers";
import { waitForLocalEmailUrl } from "./local-wrangler-state";
import {
  countTeamMembershipsByEmail,
  createOwnerAndTeam,
  seedPendingInvitation,
  TEAMS_COPY,
  uniqueSuffix,
} from "./team-helpers";

test("lets an unregistered invitee sign up, verify, and accept the invitation", async () => {
  const { teamId, teamName, teamPathname, ownerId } = await createOwnerAndTeam({
    label: "Unregistered",
  });
  const inviteeEmail = `unregistered-invitee-${uniqueSuffix()}@example.com`;
  const rawToken = `unregistered-accept-${uniqueSuffix()}`;
  const inviteReturnPath = `/team-invite?token=${encodeURIComponent(rawToken)}`;

  await seedPendingInvitation({ email: inviteeEmail, invitedBy: ownerId, rawToken, teamId });

  // A signed-out invitee is handed off to sign-in with the invite return URL preserved.
  await loadAppFrame(inviteReturnPath, { waitForNetworkIdle: true });
  await expectAppPathname("/sign-in");
  const redirectParam = new URL(getAppCurrentUrl()).searchParams.get("redirect");
  expect(redirectParam).toContain("/team-invite");
  expect(redirectParam).toContain(rawToken);

  // The invitee has no account yet, so they register through the real sign-up UI.
  await loadAppFrame("/sign-up?redirect=%2Fdashboard", { waitForNetworkIdle: true });
  await fillAppPlaceholder(AUTH_COPY.Common.emailPlaceholder, inviteeEmail);
  await fillAppPlaceholder(AUTH_COPY.SignUp.firstNamePlaceholder, "Unregistered");
  await fillAppPlaceholder(AUTH_COPY.SignUp.lastNamePlaceholder, "Invitee");
  await fillAppPlaceholder(AUTH_COPY.Common.passwordPlaceholder, "correct horse battery staple");
  await clickAppRole("button", AUTH_COPY.SignUp.createAccountWithPassword);
  await expectAppPathname("/dashboard");

  // Acceptance requires a verified email, so complete verification before following the link.
  const verificationUrl = await waitForLocalEmailUrl({
    email: inviteeEmail,
    pathname: "/verify-email",
  });
  await navigateAppFrame(`${verificationUrl.pathname}${verificationUrl.search}`);
  await expectAppToast(AUTH_COPY.VerifyEmail.toastVerifySuccess);

  // Following the invite link now accepts and lands the new member on the team page.
  await navigateAppFrame(inviteReturnPath);
  await expectAppPathname(teamPathname);
  await expectAppText(teamName, { exact: true });

  expect(await countTeamMembershipsByEmail({ teamId, email: inviteeEmail })).toBe(1);
}, scaleE2ETimeout(40_000));

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
  await expectAppText(AUTH_COPY.TeamInvite.errorTitle, { exact: true });
  await expectAppText(TEAMS_COPY.errorInvitationExpired);

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
  await expectAppText(AUTH_COPY.TeamInvite.errorTitle, { exact: true });
  await expectAppText(TEAMS_COPY.errorInvitationWrongEmail);

  // Neither rejected acceptance created a membership for the signed-in user.
  expect(await countTeamMembershipsByEmail({ teamId, email: matchingEmail })).toBe(0);
});
