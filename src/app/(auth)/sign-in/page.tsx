import type { Metadata, Route } from "next";
import { getSessionFromCookie } from "@/utils/auth";
import { redirect } from "next/navigation";
import SignInClientPage from "./sign-in.client";
import { REDIRECT_AFTER_SIGN_IN } from "@/constants";
import { isServerActionRequest } from "@/utils/is-server-action-request";

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
  const session = await getSessionFromCookie();
  const isActionRequest = await isServerActionRequest();
  const redirectPath = (
    redirectParam?.startsWith("/") ? redirectParam : REDIRECT_AFTER_SIGN_IN
  ) as Route;

  // TODO(vinext): Remove this server-action guard once cloudflare/vinext#654
  // and cloudflare/vinext#1347 are fixed. Auth actions set session cookies,
  // then Vinext re-renders this page and currently turns this redirect into an
  // action redirect response before next-safe-action can finish onSuccess.
  if (session && !isActionRequest) {
    return redirect(redirectPath);
  }

  return (
    <SignInClientPage redirectPath={redirectPath} />
  )
}

export default SignInPage;
