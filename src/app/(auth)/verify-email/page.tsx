import { Metadata } from "next";
import { getSessionFromCookie } from "@/utils/auth";
import { redirect } from "next/navigation";
import VerifyEmailClientComponent from "./verify-email.client";
import { REDIRECT_AFTER_SIGN_IN } from "@/constants";
import { isServerActionRequest } from "@/utils/is-server-action-request";

export const metadata: Metadata = {
  title: "Verify Email",
  description: "Verify your email address",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const session = await getSessionFromCookie();
  const isActionRequest = await isServerActionRequest();
  const token = (await searchParams).token;

  // TODO(vinext): Remove this server-action guard once cloudflare/vinext#654
  // and cloudflare/vinext#1347 are fixed. This action updates the session,
  // then Vinext re-renders this page and currently turns this redirect into an
  // action redirect response before next-safe-action can finish onSuccess.
  if (session?.user.emailVerified && !isActionRequest) {
    return redirect(REDIRECT_AFTER_SIGN_IN);
  }

  if (!token) {
    return redirect('/sign-in');
  }

  return <VerifyEmailClientComponent />;
}
