import type { Metadata, Route } from "next";
import { getSessionFromCookie } from "@/utils/auth";
import SignUpClientComponent from "./sign-up.client";
import { redirect } from "next/navigation";
import { REDIRECT_AFTER_SIGN_IN } from "@/constants";

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
  const session = await getSessionFromCookie();
  const redirectPath = (
    redirectParam?.startsWith("/") ? redirectParam : REDIRECT_AFTER_SIGN_IN
  ) as Route;

  if (session) {
    return redirect(redirectPath);
  }

  return <SignUpClientComponent redirectPath={redirectPath} />
}

export default SignUpPage;
