import { beforeAll, test } from "vitest";

import {
  clickAppRole,
  expectAppPathname,
  expectAppText,
  expectAppToast,
  fillAppLabel,
  fillAppPlaceholder,
  loadAppFrame,
} from "./app-frame";
import {
  AUTH_COPY,
  createVerifiedUserInLocalD1,
  SEEDED_USER_PASSWORD,
  signInWithPassword,
} from "./auth-helpers";
import { queryLocalD1, sqlStringLiteral } from "./local-wrangler-state";

// The two journeys the feature exists for: staff suspend somebody through the panel and that
// person can no longer sign in, and a blocked pattern refuses a new account at the form.

// Hyphens, not underscores: this id also becomes a domain label, and an underscore there fails
// the sign-up form's own email validation before the request ever reaches the blocklist.
const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const adminEmail = `ban-admin-${uniqueId}@example.com`;
const targetEmail = `ban-target-${uniqueId}@example.com`;
const blockedDomain = `blocked-${uniqueId}.example.com`;

async function seedBlockedDomain(): Promise<void> {
  const now = Math.floor(Date.now() / 1_000);

  await queryLocalD1({
    sql: `
      insert into banned_email (id, createdAt, updatedAt, updateCounter, kind, value, pattern)
      values (
        ${sqlStringLiteral(`bmail_e2e_${uniqueId}`)},
        ${now},
        ${now},
        0,
        'domain',
        ${sqlStringLiteral(blockedDomain)},
        ${sqlStringLiteral(`*@${blockedDomain}`)}
      );
    `,
  });
}

beforeAll(async () => {
  await Promise.all([
    createVerifiedUserInLocalD1({
      email: adminEmail,
      firstName: "Ban",
      idPrefix: "usr_ban_admin",
      lastName: "Admin",
      role: "admin",
    }),
    createVerifiedUserInLocalD1({
      email: targetEmail,
      firstName: "Ban",
      idPrefix: "usr_ban_target",
      lastName: "Target",
    }),
    seedBlockedDomain(),
  ]);
});

test("refuses a sign-up at a blocked domain", async () => {
  await loadAppFrame("/sign-up?redirect=%2Fdashboard", { waitForHydration: true });

  await fillAppPlaceholder(AUTH_COPY.Common.emailPlaceholder, `newcomer@${blockedDomain}`);
  await fillAppPlaceholder(AUTH_COPY.SignUp.firstNamePlaceholder, "New");
  await fillAppPlaceholder(AUTH_COPY.SignUp.lastNamePlaceholder, "Comer");
  await fillAppPlaceholder(AUTH_COPY.Common.passwordPlaceholder, "correct horse battery staple");
  await clickAppRole("button", AUTH_COPY.SignUp.createAccountWithPassword);

  await expectAppToast(AUTH_COPY.SignUp.errorEmailNotAllowed);
  await expectAppPathname("/sign-up");
});

test("an admin bans an account, and that account can no longer sign in", async () => {
  const targetUserId = await queryLocalD1({
    sql: `select id from user where email = ${sqlStringLiteral(targetEmail)};`,
  });

  await signInWithPassword({
    email: adminEmail,
    password: SEEDED_USER_PASSWORD,
    redirectPath: `/admin/users/${targetUserId}`,
  });

  await expectAppText("Account suspension", { exact: true });
  await clickAppRole("button", "Ban this account");

  await fillAppLabel({ label: "Internal reason", value: "E2E suspension" });
  // The destructive-action guard: the acting admin types the address before the button enables.
  await fillAppLabel({ label: `Type ${targetEmail} to confirm`, value: targetEmail });
  await clickAppRole("button", "Ban and revoke access");

  await expectAppToast("Account banned. A notice was queued.");

  // A fresh context: the acting admin is still signed in on the current one, and `/sign-in`
  // would redirect them straight back to the dashboard.
  await loadAppFrame("/sign-in?redirect=%2Fdashboard", { waitForHydration: true });
  await fillAppPlaceholder(AUTH_COPY.Common.emailPlaceholder, targetEmail);
  await fillAppPlaceholder(AUTH_COPY.Common.passwordPlaceholder, SEEDED_USER_PASSWORD);
  await clickAppRole("button", AUTH_COPY.SignIn.signInWithPassword);

  await expectAppToast(AUTH_COPY.SignIn.errorAccountSuspended);
  await expectAppPathname("/sign-in");
});
