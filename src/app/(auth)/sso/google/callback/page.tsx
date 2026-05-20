import { Metadata } from "next";
import { getSessionFromCookie } from "@/utils/auth";
import { redirect } from "next/navigation";
import GoogleCallbackClientComponent from "./google-callback.client";
import { REDIRECT_AFTER_SIGN_IN } from "@/constants";
import { isServerActionRequest } from "@/utils/is-server-action-request";

export const metadata: Metadata = {
  title: "Sign in with Google",
  description: "Complete your sign in with Google",
};

export default async function GoogleCallbackPage() {
  const session = await getSessionFromCookie();
  const isActionRequest = await isServerActionRequest();

  // TODO(vinext): Remove this server-action guard once cloudflare/vinext#654
  // and cloudflare/vinext#1347 are fixed. Auth actions set session cookies,
  // then Vinext re-renders this page and currently turns this redirect into an
  // action redirect response before next-safe-action can finish onSuccess.
  if (session && !isActionRequest) {
    return redirect(REDIRECT_AFTER_SIGN_IN);
  }

  return <GoogleCallbackClientComponent />;
}
