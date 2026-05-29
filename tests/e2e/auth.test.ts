import { beforeAll, describe, expect, test } from "vitest";
import {
  clickAppRole,
  expectAppLabelValue,
  expectAppPathnameStartsWith,
  fetchAppPath,
  expectNoAppToast,
  expectNoAppText,
  expectAppPathname,
  expectAppText,
  expectAppToast,
  fillAppLabel,
  fillAppPlaceholder,
  loadAppFrame,
  navigateAppFrame,
  reloadAppFrame,
} from "./app-frame";
import {
  createVerifiedUserInLocalD1,
  signInSeededMember,
  signInWithPassword,
} from "./auth-helpers";
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

async function readExpiringTokenUrlFromLocalKV({
  email,
  prefix,
  pathname,
}: {
  email: string;
  prefix: string;
  pathname: string;
}): Promise<URL | undefined> {
  const userId = await readUserIdFromLocalD1(email);

  if (!userId) {
    return undefined;
  }

  for (const { key, value } of await listLocalKVEntries({ prefix })) {
    try {
      const payload = JSON.parse(value) as { userId?: string };

      if (payload.userId === userId) {
        return new URL(`${pathname}?token=${key.replace(prefix, "")}`, "http://localhost");
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

async function readVerificationUrlFromLocalKV(email: string): Promise<URL | undefined> {
  return readExpiringTokenUrlFromLocalKV({
    email,
    prefix: "email-verification:",
    pathname: "/verify-email",
  });
}

async function readPasswordResetUrlFromLocalKV(email: string): Promise<URL | undefined> {
  return readExpiringTokenUrlFromLocalKV({
    email,
    prefix: "password-reset:",
    pathname: "/reset-password",
  });
}

async function waitForVerificationUrl({
  email,
}: {
  email: string;
}): Promise<URL> {
  const timeoutAt = Date.now() + 5_000;

  while (Date.now() < timeoutAt) {
    const verificationUrl = await readVerificationUrlFromLocalKV(email);

    if (verificationUrl) {
      return verificationUrl;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for verification URL.");
}

async function waitForPasswordResetUrl({
  email,
}: {
  email: string;
}): Promise<URL> {
  const timeoutAt = Date.now() + 5_000;

  while (Date.now() < timeoutAt) {
    const resetUrl = await readPasswordResetUrlFromLocalKV(email);

    if (resetUrl) {
      return resetUrl;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for password reset URL.");
}

test("shows sign-in password validation before submitting", async () => {
  await loadAppFrame("/sign-in?redirect=%2Fdashboard", { waitForHydration: true });

  await fillAppPlaceholder("Email address", "test@test.com");
  await fillAppPlaceholder("Password", "short");
  await clickAppRole("button", "Sign In with Password");

  await expectAppText("Password must be at least 8 characters", { exact: true });
});

test("redirects anonymous users away from protected settings", async () => {
  await loadAppFrame("/settings");

  await expectAppPathname("/sign-in");
});

test("shows a visible error toast for invalid credentials", async () => {
  await loadAppFrame("/sign-in?redirect=%2Fdashboard", { waitForHydration: true });

  await fillAppPlaceholder("Email address", "test@test.com");
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
  await fillAppPlaceholder("First Name", "A");
  await fillAppPlaceholder("Last Name", "B");
  await fillAppPlaceholder("Password", "short");
  await clickAppRole("button", "Create Account with Password");

  await expectAppText("Must be at least 2 characters", { exact: true });
  await expectAppText("Must be at least 6 characters", { exact: true });
});

test("creates and verifies a new password account", async () => {
  const email = `new-account-${Date.now()}@example.com`;

  await loadAppFrame("/sign-up?redirect=%2Fdashboard", { waitForHydration: true });

  await fillAppPlaceholder("Email address", email);
  await fillAppPlaceholder("First Name", "New");
  await fillAppPlaceholder("Last Name", "Account");
  await fillAppPlaceholder("Password", "password");
  await clickAppRole("button", "Create Account with Password");

  await expectAppPathname("/dashboard");
  await expectNoAppToast("Creating your account...");

  const verificationUrl = await waitForVerificationUrl({
    email,
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
  const oldPassword = "password";
  const newPassword = "new-password";

  await createVerifiedUserInLocalD1({
    email,
    firstName: "Reset",
    lastName: "Account",
  });

  await loadAppFrame("/forgot-password", { waitForHydration: true });
  await fillAppLabel({ label: "Email", value: email });
  await clickAppRole("button", "Send Reset Instructions");
  await expectAppToast("Reset instructions sent");

  const resetUrl = await waitForPasswordResetUrl({
    email,
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
  let settingsUserEmail: string;

  beforeAll(async () => {
    settingsUserEmail = `settings-user-${Date.now()}@example.com`;

    await createVerifiedUserInLocalD1({
      email: settingsUserEmail,
    });
  });

  test("validates profile settings before saving", async () => {
    await signInWithPassword({
      email: settingsUserEmail,
      password: "password",
      redirectPath: "/settings",
    });
    await navigateAppFrame("/settings", { waitForHydration: true });

    await expectAppText("Profile Settings", { exact: true });
    await fillAppLabel({ label: "First Name", value: "A" });
    await fillAppLabel({ label: "Last Name", value: "B" });
    await clickAppRole("button", "Save changes");

    await expectAppText("First name must be at least 2 characters.", { exact: true });
    await expectAppText("Last name must be at least 2 characters.", { exact: true });
  });

  test("updates profile settings and shows a visible success toast", async () => {
    await signInWithPassword({
      email: settingsUserEmail,
      password: "password",
      redirectPath: "/settings",
    });
    await navigateAppFrame("/settings", { waitForHydration: true });

    await expectAppText("Profile Settings", { exact: true });
    await fillAppLabel({ label: "First Name", value: "E2E" });
    await fillAppLabel({ label: "Last Name", value: "Tester" });
    await clickAppRole("button", "Save changes");

    await expectAppToast("Profile updated successfully");
    await reloadAppFrame();
    await expectAppText("Profile Settings", { exact: true });
    await expectAppLabelValue({ label: "First Name", value: "E2E" });
    await expectAppLabelValue({ label: "Last Name", value: "Tester" });
  });
});
