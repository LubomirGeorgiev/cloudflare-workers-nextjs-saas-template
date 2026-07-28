import { describe, expect, test } from "vitest";
import {
  clickAppRole,
  expectAppLabelValue,
  expectAppPathnameStartsWith,
  fetchAppPath,
  expectNoAppToast,
  expectNoAppText,
  expectAppPathname,
  expectAppRoleText,
  expectAppText,
  expectAppTextCount,
  expectAppToast,
  fillAppLabel,
  fillAppPlaceholder,
  loadAppFrame,
  navigateAppFrame,
} from "./app-frame";
import {
  createVerifiedUserInLocalD1,
  SEEDED_ADMIN_EMAIL,
  SEEDED_MEMBER_EMAIL,
  SEEDED_USER_PASSWORD,
  signInSeededMember,
  signInWithPassword,
} from "./auth-helpers";
import {
  queryLocalD1,
  sqlStringLiteral,
  waitForLocalEmailUrl,
} from "./local-wrangler-state";
import {
  LEGACY_PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../../src/schemas/password.schema";
import { NAME_MIN_LENGTH } from "../../src/constants";

const NAME_MIN_LENGTH_MESSAGE = `Must be at least ${NAME_MIN_LENGTH} characters`;

function passwordMinLengthMessage(min: number) {
  return `Password must be at least ${min} characters`;
}

// Validation limits are template-configurable, so drive the "too short" inputs off the
// constant instead of literals that silently stop being too short.
function tooShort(min: number) {
  return "a".repeat(min - 1);
}

test("shows sign-in password validation before submitting", async () => {
  await loadAppFrame("/sign-in?redirect=%2Fdashboard", { waitForHydration: true });

  await fillAppPlaceholder("Email address", SEEDED_ADMIN_EMAIL);
  await fillAppPlaceholder("Password", tooShort(LEGACY_PASSWORD_MIN_LENGTH));
  await clickAppRole("button", "Sign In with Password");

  await expectAppText(passwordMinLengthMessage(LEGACY_PASSWORD_MIN_LENGTH), { exact: true });
});

test("redirects anonymous users away from protected settings", async () => {
  await loadAppFrame("/settings");

  await expectAppPathname("/sign-in");
});

test("shows a visible error toast for invalid credentials", async () => {
  await loadAppFrame("/sign-in?redirect=%2Fdashboard", { waitForHydration: true });

  await fillAppPlaceholder("Email address", SEEDED_ADMIN_EMAIL);
  await fillAppPlaceholder("Password", "wrongpass");
  await clickAppRole("button", "Sign In with Password");

  await expectAppToast("Invalid email or password");
});

test("sanitizes unsafe sign-in redirect targets", async () => {
  await signInSeededMember("https://evil.example/phishing", "/dashboard");

  await expectAppPathname("/dashboard");
  await expectAppText("Dashboard", { exact: true });
});

test("signs in with the seeded password user", async () => {
  await signInSeededMember();

  await expectAppText("Dashboard", { exact: true });
  const storedHash = await queryLocalD1({
    sql: `select passwordHash from user where email = ${sqlStringLiteral(SEEDED_MEMBER_EMAIL)} limit 1;`,
  });
  expect(storedHash).toMatch(/^pbkdf2-sha256\$600000\$/);
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

test("shows sign-up validation before creating an account", async () => {
  await loadAppFrame("/sign-up?redirect=%2Fdashboard", { waitForHydration: true });

  await expectAppText("Create your account", { exact: true });
  await fillAppPlaceholder("Email address", "new-user-e2e@example.com");
  await fillAppPlaceholder("First Name", tooShort(NAME_MIN_LENGTH));
  await fillAppPlaceholder("Last Name", tooShort(NAME_MIN_LENGTH));
  await fillAppPlaceholder("Password", tooShort(PASSWORD_MIN_LENGTH));
  await clickAppRole("button", "Create Account with Password");

  await expectAppText(NAME_MIN_LENGTH_MESSAGE, { exact: true });
  await expectAppText(passwordMinLengthMessage(PASSWORD_MIN_LENGTH), { exact: true });
});

test("creates and verifies a new password account", async () => {
  const email = `new-account-${Date.now()}@example.com`;

  await loadAppFrame("/sign-up?redirect=%2Fdashboard", { waitForHydration: true });

  await fillAppPlaceholder("Email address", email);
  await fillAppPlaceholder("First Name", "New");
  await fillAppPlaceholder("Last Name", "Account");
  await fillAppPlaceholder("Password", "correct horse battery staple");
  await clickAppRole("button", "Create Account with Password");

  await expectAppPathname("/dashboard");
  await expectNoAppToast("Creating your account...");

  const verificationUrl = await waitForLocalEmailUrl({
    email,
    pathname: "/verify-email",
  });

  await navigateAppFrame(`${verificationUrl.pathname}${verificationUrl.search}`);

  await expectAppToast("Email verified successfully");
  await expectAppPathname("/dashboard");
  await expectNoAppToast("Verifying your email...");
  await expectAppText("Dashboard", { exact: true });
}, 18_000);

test("keeps forgot-password responses enumeration-safe", async () => {
  await loadAppFrame("/forgot-password", { waitForHydration: true });

  await fillAppLabel({ label: "Email", value: "missing-user-e2e@example.com" });
  await clickAppRole("button", "Send Reset Instructions");

  await expectAppToast("Reset instructions sent");
  await expectAppText("Check your email", { exact: true });
  await expectAppText("If an account exists with that email, we've sent you instructions to reset your password.", { exact: true });
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
  await fillAppLabel({ label: "Email", value: email });
  await clickAppRole("button", "Send Reset Instructions");
  await expectAppToast("Reset instructions sent");

  const resetUrl = await waitForLocalEmailUrl({
    email,
    pathname: "/reset-password",
  });

  await navigateAppFrame(`${resetUrl.pathname}${resetUrl.search}`, {
    waitForHydration: true,
  });

  await fillAppLabel({ label: "New Password", value: newPassword });
  await fillAppLabel({ label: "Confirm Password", value: newPassword });
  await clickAppRole("button", "Reset Password");
  await expectAppToast("Password reset successfully");
  await expectAppText("Password Reset Successfully", { exact: true });

  const reusedTokenResponse = await fetchAppPath(`${resetUrl.pathname}${resetUrl.search}`, {
    redirect: "manual",
  });
  expect(reusedTokenResponse.status).toBe(404);

  await loadAppFrame("/sign-in?redirect=%2Fdashboard", { waitForHydration: true });
  await fillAppPlaceholder("Email address", email);
  await fillAppPlaceholder("Password", oldPassword);
  await clickAppRole("button", "Sign In with Password");
  await expectAppToast("Invalid email or password");

  await signInWithPassword({
    email,
    password: newPassword,
  });
  await expectAppPathnameStartsWith("/dashboard");
}, 20_000);

describe("profile settings", () => {
  test("validates profile settings before saving", async () => {
    await signInSeededMember("/settings");
    await navigateAppFrame("/settings", { waitForHydration: true });

    await expectAppText("Profile Settings", { exact: true });
    await fillAppLabel({ label: "First Name", value: tooShort(NAME_MIN_LENGTH) });
    await fillAppLabel({ label: "Last Name", value: tooShort(NAME_MIN_LENGTH) });
    await clickAppRole("button", "Save changes");

    // Both name fields share the central `Validation.minLength` message, so expect it
    // to render once per invalid field rather than field-specific copy.
    await expectAppTextCount(NAME_MIN_LENGTH_MESSAGE, 2, { exact: true });
  });

  test("updates profile settings and shows a visible success toast", async () => {
    const email = `profile-admin-${Date.now()}@example.com`;

    await createVerifiedUserInLocalD1({
      email,
      firstName: "Admin",
      idPrefix: "usr_profile_admin",
      lastName: "Profile",
      role: "admin",
    });

    await signInWithPassword({
      email,
      password: SEEDED_USER_PASSWORD,
      redirectPath: "/settings",
    });
    await navigateAppFrame("/settings", { waitForHydration: true });

    await expectAppText("Profile Settings", { exact: true });
    await expectAppLabelValue({ label: "First Name", value: "Admin" });
    await expectAppLabelValue({ label: "Last Name", value: "Profile" });
    await expectAppText("Admin Profile", { exact: true });

    await fillAppLabel({ label: "First Name", value: "E2E" });
    await fillAppLabel({ label: "Last Name", value: "Tester" });
    await clickAppRole("button", "Save changes");

    await expectAppToast("Profile updated successfully");
    await expectAppText("Profile Settings", { exact: true });
    await expectAppLabelValue({ label: "First Name", value: "E2E" });
    await expectAppLabelValue({ label: "Last Name", value: "Tester" });
    await expectAppText("E2E Tester", { exact: true });

    await navigateAppFrame("/", { waitForHydration: true });
    await expectNoAppText("E2E Tester", { exact: true });

    await navigateAppFrame("/admin", { waitForHydration: true });
    await expectAppRoleText({
      role: "navigation",
      name: "Admin navigation",
      text: "E2E Tester",
      exact: true,
    });
  });
});
