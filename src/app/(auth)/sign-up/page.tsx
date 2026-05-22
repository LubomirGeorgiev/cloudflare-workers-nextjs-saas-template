import type { Metadata } from "next";
import SignUpClientComponent from "./sign-up.client";
import { getSafeRedirectPath, redirectAuthenticatedUser } from "@/utils/auth-redirect";

export const metadata: Metadata = {
  title: "Sign Up",
  description: "Create a new account",
};

const SignUpPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) => {
  const { redirect: redirectParam } = await searchParams;
  const redirectPath = getSafeRedirectPath({ value: redirectParam });

  await redirectAuthenticatedUser({ redirectPath });

  return <SignUpClientComponent redirectPath={redirectPath} />
}

export default SignUpPage;
