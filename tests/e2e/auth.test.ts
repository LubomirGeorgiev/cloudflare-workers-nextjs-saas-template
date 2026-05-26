import { test } from "vitest";
import {
  clickAppRole,
  expectAppLabelValue,
  expectNoAppToast,
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

async function readVerificationUrlFromLocalKV(email: string): Promise<URL | undefined> {
  const userId = await readUserIdFromLocalD1(email);

  if (!userId) {
    return undefined;
  }

  for (const { key, value } of await listLocalKVEntries({ prefix: "email-verification:" })) {
    try {
      const payload = JSON.parse(value) as { userId?: string };

      if (payload.userId === userId) {
        return new URL(`/verify-email?token=${key.replace("email-verification:", "")}`, "http://localhost");
      }
    } catch {
      continue;
    }
  }

  return undefined;
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

async function signInSeededUser(
  redirectPath = "/dashboard",
  expectedPathname = redirectPath
): Promise<void> {
  await loadAppFrame(`/sign-in?redirect=${encodeURIComponent(redirectPath)}`, {
    waitForHydration: true,
  });

  await fillAppPlaceholder("Email address", "test@test.com");
  await fillAppPlaceholder("Password", "password");
  await clickAppRole("button", "Sign In with Password");
  await expectAppPathname(expectedPathname);
  await expectNoAppToast("Signing you in...");
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
  await signInSeededUser("https://evil.example/phishing", "/dashboard");

  await expectAppPathname("/dashboard");
  await expectAppText("Dashboard", { exact: true });
});

test("signs in with the seeded password user", async () => {
  await signInSeededUser();

  await expectAppText("Dashboard", { exact: true });
});

test("redirects signed-in users away from auth pages", async () => {
  await signInSeededUser();
  await navigateAppFrame("/sign-in?redirect=%2Fsettings", { waitForHydration: true });

  await expectAppPathname("/settings");
  await expectAppText("Profile Settings", { exact: true });
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

  await navigateAppFrame(`${verificationUrl.pathname}${verificationUrl.search}`, {
    waitForHydration: true,
  });

  await expectAppToast("Email verified successfully");
  await expectAppPathname("/dashboard");
  await expectNoAppToast("Verifying your email...");
  await expectAppText("Dashboard", { exact: true });
}, 12_000);

test("keeps forgot-password responses enumeration-safe", async () => {
  await loadAppFrame("/forgot-password", { waitForHydration: true });

  await fillAppLabel({ label: "Email", value: "missing-user-e2e@example.com" });
  await clickAppRole("button", "Send Reset Instructions");

  await expectAppToast("Reset instructions sent");
  await expectAppText("Check your email", { exact: true });
  await expectAppText("If an account exists with that email, we've sent you instructions to reset your password.", { exact: true });
});

test("validates profile settings before saving", async () => {
  await signInSeededUser("/settings");

  await expectAppText("Profile Settings", { exact: true });
  await fillAppLabel({ label: "First Name", value: "A" });
  await fillAppLabel({ label: "Last Name", value: "B" });
  await clickAppRole("button", "Save changes");

  await expectAppText("First name must be at least 2 characters.", { exact: true });
  await expectAppText("Last name must be at least 2 characters.", { exact: true });
});

test("updates profile settings and shows a visible success toast", async () => {
  await signInSeededUser("/settings");

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
