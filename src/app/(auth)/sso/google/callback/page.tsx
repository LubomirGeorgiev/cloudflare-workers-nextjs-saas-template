import { Metadata } from "next";
import GoogleCallbackClientComponent from "./google-callback.client";
import { REDIRECT_AFTER_SIGN_IN } from "@/constants";
import { redirectAuthenticatedUser } from "@/utils/auth-redirect";

export const metadata: Metadata = {
  title: "Sign in with Google",
  description: "Complete your sign in with Google",
};

export default async function GoogleCallbackPage() {
  await redirectAuthenticatedUser({ redirectPath: REDIRECT_AFTER_SIGN_IN });

  return <GoogleCallbackClientComponent />;
}
