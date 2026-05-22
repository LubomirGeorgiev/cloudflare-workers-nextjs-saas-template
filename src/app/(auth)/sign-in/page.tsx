import type { Metadata } from "next";
import SignInClientPage from "./sign-in.client";
import { getSafeRedirectPath, redirectAuthenticatedUser } from "@/utils/auth-redirect";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your account",
};

const SignInPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) => {
  const { redirect: redirectParam } = await searchParams;
  const redirectPath = getSafeRedirectPath({ value: redirectParam });

  await redirectAuthenticatedUser({ redirectPath });

  return (
    <SignInClientPage redirectPath={redirectPath} />
  )
}

export default SignInPage;
