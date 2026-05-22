import type { Metadata, Route } from "next";
import SignUpClientComponent from "./sign-up.client";
import { REDIRECT_AFTER_SIGN_IN } from "@/constants";
import { redirectAuthenticatedUser } from "@/utils/auth-redirect";

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
  const redirectPath = (
    redirectParam?.startsWith("/") ? redirectParam : REDIRECT_AFTER_SIGN_IN
  ) as Route;

  await redirectAuthenticatedUser({ redirectPath });

  return <SignUpClientComponent redirectPath={redirectPath} />
}

export default SignUpPage;
