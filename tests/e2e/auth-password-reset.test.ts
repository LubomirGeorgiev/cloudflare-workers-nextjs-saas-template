import { expect, test } from "vitest";
import {
  clickAppRole,
  expectAppPathnameStartsWith,
  expectAppText,
  expectAppToast,
  fetchAppPath,
  fillAppLabel,
  fillAppPlaceholder,
  loadAppFrame,
  navigateAppFrame,
} from "./app-frame";
import {
  AUTH_COPY,
  createVerifiedUserInLocalD1,
  SEEDED_USER_PASSWORD,
  signInWithPassword,
} from "./auth-helpers";
import { waitForLocalEmailUrl } from "./local-wrangler-state";

test("keeps forgot-password responses enumeration-safe", async () => {
  await loadAppFrame("/forgot-password", { waitForHydration: true });

  await fillAppLabel({ label: AUTH_COPY.Common.emailLabel, value: "missing-user-e2e@example.com" });
  await clickAppRole("button", AUTH_COPY.ForgotPassword.sendInstructions);

  await expectAppToast(AUTH_COPY.ForgotPassword.toastSent);
  await expectAppText(AUTH_COPY.ForgotPassword.checkEmailTitle, { exact: true });
  await expectAppText(AUTH_COPY.ForgotPassword.checkEmailDescription, { exact: true });
});

test("resets a verified user's password and invalidates the reset token", async () => {
  const email = `password-reset-${Date.now()}@example.com`;
  const oldPassword = SEEDED_USER_PASSWORD;
  const newPassword = "new-password-strong";

  await createVerifiedUserInLocalD1({
    email,
    firstName: "Reset",
    lastName: "Account",
  });

  await loadAppFrame("/forgot-password", { waitForHydration: true });
  await fillAppLabel({ label: AUTH_COPY.Common.emailLabel, value: email });
  await clickAppRole("button", AUTH_COPY.ForgotPassword.sendInstructions);
  await expectAppToast(AUTH_COPY.ForgotPassword.toastSent);

  const resetUrl = await waitForLocalEmailUrl({
    email,
    pathname: "/reset-password",
  });

  await navigateAppFrame(`${resetUrl.pathname}${resetUrl.search}`, {
    waitForHydration: true,
  });

  await fillAppLabel({ label: AUTH_COPY.ResetPassword.newPasswordLabel, value: newPassword });
  await fillAppLabel({ label: AUTH_COPY.ResetPassword.confirmPasswordLabel, value: newPassword });
  await clickAppRole("button", AUTH_COPY.ResetPassword.submit);
  await expectAppToast(AUTH_COPY.ResetPassword.toastResetSuccess);
  await expectAppText(AUTH_COPY.ResetPassword.successTitle, { exact: true });

  const reusedTokenResponse = await fetchAppPath(`${resetUrl.pathname}${resetUrl.search}`, {
    redirect: "manual",
  });
  expect(reusedTokenResponse.status).toBe(404);

  await loadAppFrame("/sign-in?redirect=%2Fdashboard", { waitForHydration: true });
  await fillAppPlaceholder(AUTH_COPY.Common.emailPlaceholder, email);
  await fillAppPlaceholder(AUTH_COPY.Common.passwordPlaceholder, oldPassword);
  await clickAppRole("button", AUTH_COPY.SignIn.signInWithPassword);
  await expectAppToast(AUTH_COPY.SignIn.errorInvalidCredentials);

  await signInWithPassword({
    email,
    password: newPassword,
  });
  await expectAppPathnameStartsWith("/dashboard");
});
