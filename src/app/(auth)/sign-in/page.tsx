import type { Metadata, Route } from "next";
import SignInClientPage from "./sign-in.client";
import { REDIRECT_AFTER_SIGN_IN } from "@/constants";
import { redirectAuthenticatedUser } from "@/utils/auth-redirect";

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
  const redirectPath = (
    redirectParam?.startsWith("/") ? redirectParam : REDIRECT_AFTER_SIGN_IN
  ) as Route;

  await redirectAuthenticatedUser({ redirectPath });

  return (
    <SignInClientPage redirectPath={redirectPath} />
  )
}

export default SignInPage;
