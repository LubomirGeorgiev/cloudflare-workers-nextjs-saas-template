import { expect, test } from "vitest";
import {
  clickAppRole,
  expectAppPathname,
  expectAppText,
  expectAppToast,
  expectNoAppToast,
  fillAppPlaceholder,
  getAppCookie,
  loadAppFrame,
  navigateAppFrame,
} from "./app-frame";
import {
  AUTH_COPY,
  DEFAULT_MESSAGES,
  NAME_MIN_LENGTH_MESSAGE,
  NON_DEFAULT_LOCALE,
  passwordMinLengthMessage,
  tooShort,
} from "./auth-helpers";
import {
  queryLocalD1,
  sqlStringLiteral,
  waitForLocalEmailUrl,
} from "./local-wrangler-state";
import { PASSWORD_MIN_LENGTH } from "../../src/schemas/password.schema";
import { NAME_MIN_LENGTH } from "../../src/constants";
import { LOCALE_COOKIE_NAME } from "../../src/i18n/config";
import { loadCatalog } from "../../src/i18n/message-catalogs";
import { localizedPathname } from "../../src/i18n/localized-pathname";

test("shows sign-up validation before creating an account", async () => {
  await loadAppFrame("/sign-up?redirect=%2Fdashboard", { waitForHydration: true });

  await expectAppText(AUTH_COPY.SignUp.heading, { exact: true });
  await fillAppPlaceholder(AUTH_COPY.Common.emailPlaceholder, "new-user-e2e@example.com");
  await fillAppPlaceholder(AUTH_COPY.SignUp.firstNamePlaceholder, tooShort(NAME_MIN_LENGTH));
  await fillAppPlaceholder(AUTH_COPY.SignUp.lastNamePlaceholder, tooShort(NAME_MIN_LENGTH));
  await fillAppPlaceholder(AUTH_COPY.Common.passwordPlaceholder, tooShort(PASSWORD_MIN_LENGTH));
  await clickAppRole("button", AUTH_COPY.SignUp.createAccountWithPassword);

  await expectAppText(NAME_MIN_LENGTH_MESSAGE, { exact: true });
  await expectAppText(passwordMinLengthMessage(PASSWORD_MIN_LENGTH), { exact: true });
});

test("creates and verifies a new password account", async () => {
  const email = `new-account-${Date.now()}@example.com`;

  await loadAppFrame("/sign-up?redirect=%2Fdashboard", { waitForHydration: true });

  await fillAppPlaceholder(AUTH_COPY.Common.emailPlaceholder, email);
  await fillAppPlaceholder(AUTH_COPY.SignUp.firstNamePlaceholder, "New");
  await fillAppPlaceholder(AUTH_COPY.SignUp.lastNamePlaceholder, "Account");
  await fillAppPlaceholder(AUTH_COPY.Common.passwordPlaceholder, "correct horse battery staple");
  await clickAppRole("button", AUTH_COPY.SignUp.createAccountWithPassword);

  await expectAppPathname("/dashboard");
  await expectNoAppToast(AUTH_COPY.SignUp.toastCreatingAccount);

  const verificationUrl = await waitForLocalEmailUrl({
    email,
    pathname: "/verify-email",
  });

  await navigateAppFrame(`${verificationUrl.pathname}${verificationUrl.search}`);

  await expectAppToast(AUTH_COPY.VerifyEmail.toastVerifySuccess);
  await expectAppPathname("/dashboard");
  await expectNoAppToast(AUTH_COPY.VerifyEmail.toastVerifying);
  await expectAppText(DEFAULT_MESSAGES.Client.Dashboard.Home.breadcrumb, { exact: true });
});

test.skipIf(!NON_DEFAULT_LOCALE)("stores and applies the locale a password account signs up in", async () => {
  const locale = NON_DEFAULT_LOCALE!;
  const email = `sign-up-locale-${Date.now()}@example.com`;
  // The form renders in the page locale, so its copy comes from that locale's catalog.
  const { Common, SignUp } = (await loadCatalog(locale)).Client.Auth;
  const signUpPath = localizedPathname({ pathname: "/sign-up", locale });

  // A fresh context has no locale cookie, so only the sign-up hand-off can write one.
  await loadAppFrame(`${signUpPath}?redirect=%2Fdashboard`, { waitForHydration: true });
  expect(await getAppCookie(LOCALE_COOKIE_NAME)).toBeUndefined();

  await fillAppPlaceholder(Common.emailPlaceholder, email);
  await fillAppPlaceholder(SignUp.firstNamePlaceholder, "Locale");
  await fillAppPlaceholder(SignUp.lastNamePlaceholder, "Account");
  await fillAppPlaceholder(Common.passwordPlaceholder, "correct horse battery staple");
  await clickAppRole("button", SignUp.createAccountWithPassword);

  await expectAppPathname(localizedPathname({ pathname: "/dashboard", locale }));
  expect(await getAppCookie(LOCALE_COOKIE_NAME)).toBe(locale);

  const storedLocale = await queryLocalD1({
    sql: `select preferredLocale from user where email = ${sqlStringLiteral(email)} limit 1;`,
  });
  expect(storedLocale).toBe(locale);
});
