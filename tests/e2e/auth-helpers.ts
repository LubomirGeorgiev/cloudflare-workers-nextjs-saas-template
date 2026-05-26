import {
  clickAppRole,
  expectAppPathname,
  expectNoAppToast,
  fillAppPlaceholder,
  loadAppFrame,
} from "./app-frame";

interface SignInWithPasswordParams {
  email: string;
  password: string;
  redirectPath?: string;
  expectedPathname?: string;
}

export async function signInWithPassword({
  email,
  password,
  redirectPath = "/dashboard",
  expectedPathname = redirectPath,
}: SignInWithPasswordParams): Promise<void> {
  await loadAppFrame(`/sign-in?redirect=${encodeURIComponent(redirectPath)}`, {
    waitForHydration: true,
  });

  await fillAppPlaceholder("Email address", email);
  await fillAppPlaceholder("Password", password);
  await clickAppRole("button", "Sign In with Password");
  await expectAppPathname(expectedPathname);
  await expectNoAppToast("Signing you in...");
}

export function signInSeededMember(
  redirectPath = "/dashboard",
  expectedPathname = redirectPath
): Promise<void> {
  return signInWithPassword({
    email: "sarah.chen@example.com",
    password: "password",
    redirectPath,
    expectedPathname,
  });
}
