import { expect, test } from "vitest";
import {
  clickAppRole,
  clickAppRoleAndWaitForNavigation,
  expectAppToast,
  fillAppLabel,
  fillAppPlaceholder,
  getAppCurrentUrl,
  getAppRequestUrls,
  loadAppFrame,
} from "./app-frame";
import { AUTH_COPY, createVerifiedUserInLocalD1, SEEDED_ADMIN_EMAIL } from "./auth-helpers";
import { waitForLocalEmailUrl } from "./local-wrangler-state";

// A native submit of the server HTML must never put a typed secret into a URL,
// where browser history, edge logs, and the Referer header keep it.
test("keeps the sign-in password out of every URL when the form submits before hydration", async () => {
  const password = uniqueSecret();

  await loadAppFrame("/sign-in?redirect=%2Fdashboard", { scriptsDisabled: true });
  await fillAppPlaceholder(AUTH_COPY.Common.emailPlaceholder, SEEDED_ADMIN_EMAIL);
  await fillAppPlaceholder(AUTH_COPY.Common.passwordPlaceholder, password);
  const submitRequest = await clickAppRoleAndWaitForNavigation({
    role: "button",
    name: AUTH_COPY.SignIn.signInWithPassword,
  });

  expect(submitRequest.method()).toBe("POST");
  expectNoUrlContains(password);
});

test("keeps the sign-up password out of every URL when the form submits before hydration", async () => {
  const password = uniqueSecret();

  await loadAppFrame("/sign-up", { scriptsDisabled: true });
  await fillAppPlaceholder(AUTH_COPY.Common.emailPlaceholder, `pre-hydration-${Date.now()}@example.com`);
  await fillAppPlaceholder(AUTH_COPY.SignUp.firstNamePlaceholder, "Before");
  await fillAppPlaceholder(AUTH_COPY.SignUp.lastNamePlaceholder, "Hydration");
  await fillAppPlaceholder(AUTH_COPY.Common.passwordPlaceholder, password);
  const submitRequest = await clickAppRoleAndWaitForNavigation({
    role: "button",
    name: AUTH_COPY.SignUp.createAccountWithPassword,
  });

  expect(submitRequest.method()).toBe("POST");
  expectNoUrlContains(password);
});

test("keeps the new password out of every URL when the reset form submits before hydration", async () => {
  const email = `pre-hydration-reset-${Date.now()}@example.com`;
  const password = uniqueSecret();

  await createVerifiedUserInLocalD1({ email });
  await loadAppFrame("/forgot-password", { waitForHydration: true });
  await fillAppLabel({ label: AUTH_COPY.Common.emailLabel, value: email });
  await clickAppRole("button", AUTH_COPY.ForgotPassword.sendInstructions);
  await expectAppToast(AUTH_COPY.ForgotPassword.toastSent);
  const resetUrl = await waitForLocalEmailUrl({ email, pathname: "/reset-password" });

  await loadAppFrame(`${resetUrl.pathname}${resetUrl.search}`, { scriptsDisabled: true });
  await fillAppLabel({ label: AUTH_COPY.ResetPassword.newPasswordLabel, value: password });
  await fillAppLabel({ label: AUTH_COPY.ResetPassword.confirmPasswordLabel, value: password });
  const submitRequest = await clickAppRoleAndWaitForNavigation({
    role: "button",
    name: AUTH_COPY.ResetPassword.submit,
  });

  expect(submitRequest.method()).toBe("POST");
  expectNoUrlContains(password);
});

function uniqueSecret(): string {
  return `pre-hydration-secret-${Date.now()}`;
}

function expectNoUrlContains(secret: string): void {
  const urls = [...getAppRequestUrls(), getAppCurrentUrl()];

  expect(urls.filter((url) => url.includes(secret))).toEqual([]);
}
