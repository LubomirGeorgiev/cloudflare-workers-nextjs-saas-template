import { expect, test } from "vitest";
import {
  clickAppRole,
  expectAppPathname,
  expectAppText,
  expectAppToast,
  expectNoAppText,
  fillAppPlaceholder,
  loadAppFrame,
  navigateAppFrame,
} from "./app-frame";
import {
  AUTH_COPY,
  createVerifiedUserInLocalD1,
  DEFAULT_MESSAGES,
  NON_DEFAULT_LOCALE,
  passwordMinLengthMessage,
  SEEDED_ADMIN_EMAIL,
  SEEDED_MEMBER_EMAIL,
  SEEDED_USER_PASSWORD,
  signInSeededMember,
  signInWithPassword,
  tooShort,
} from "./auth-helpers";
import { queryLocalD1, sqlStringLiteral } from "./local-wrangler-state";
import { LEGACY_PASSWORD_MIN_LENGTH } from "../../src/schemas/password.schema";
import { localizedPathname } from "../../src/i18n/localized-pathname";

test("shows sign-in password validation before submitting", async () => {
  await loadAppFrame("/sign-in?redirect=%2Fdashboard", { waitForHydration: true });

  await fillAppPlaceholder(AUTH_COPY.Common.emailPlaceholder, SEEDED_ADMIN_EMAIL);
  await fillAppPlaceholder(AUTH_COPY.Common.passwordPlaceholder, tooShort(LEGACY_PASSWORD_MIN_LENGTH));
  await clickAppRole("button", AUTH_COPY.SignIn.signInWithPassword);

  await expectAppText(passwordMinLengthMessage(LEGACY_PASSWORD_MIN_LENGTH), { exact: true });
});

test("redirects anonymous users away from protected settings", async () => {
  await loadAppFrame("/settings");

  await expectAppPathname("/sign-in");
});

test("shows a visible error toast for invalid credentials", async () => {
  await loadAppFrame("/sign-in?redirect=%2Fdashboard", { waitForHydration: true });

  await fillAppPlaceholder(AUTH_COPY.Common.emailPlaceholder, SEEDED_ADMIN_EMAIL);
  await fillAppPlaceholder(AUTH_COPY.Common.passwordPlaceholder, "wrongpass");
  await clickAppRole("button", AUTH_COPY.SignIn.signInWithPassword);

  await expectAppToast(AUTH_COPY.SignIn.errorInvalidCredentials);
});

test.skipIf(!NON_DEFAULT_LOCALE)("signs a user in under their stored locale", async () => {
  const preferredLocale = NON_DEFAULT_LOCALE!;
  const email = `preferred-locale-${Date.now()}@example.com`;

  await createVerifiedUserInLocalD1({ email, idPrefix: "usr_locale", preferredLocale });

  // The form is on the default locale; the stored preference must move the target under its prefix.
  await signInWithPassword({
    email,
    password: SEEDED_USER_PASSWORD,
    redirectPath: "/dashboard",
    expectedPathname: localizedPathname({ pathname: "/dashboard", locale: preferredLocale }),
  });
});

test("sanitizes unsafe sign-in redirect targets", async () => {
  await signInSeededMember("https://evil.example/phishing", "/dashboard");

  await expectAppPathname("/dashboard");
  await expectAppText(DEFAULT_MESSAGES.Client.Dashboard.Home.breadcrumb, { exact: true });
});

test("signs in with the seeded password user", async () => {
  await signInSeededMember();

  await expectAppText(DEFAULT_MESSAGES.Client.Dashboard.Home.breadcrumb, { exact: true });
  const storedHash = await queryLocalD1({
    sql: `select passwordHash from user where email = ${sqlStringLiteral(SEEDED_MEMBER_EMAIL)} limit 1;`,
  });
  expect(storedHash).toMatch(/^pbkdf2-sha256\$100000\$/);
});

test("redirects signed-in users away from auth pages", async () => {
  await signInSeededMember();
  await navigateAppFrame("/sign-in?redirect=%2Fsettings", { waitForHydration: true });

  await expectAppPathname("/settings");
});

test("keeps non-admin users out of the admin area", async () => {
  await signInSeededMember("/admin", "/");

  await expectAppPathname("/");
  await expectNoAppText("User Management", { exact: true });
});
