import { Metadata } from "next";
import { redirect } from "next/navigation";
import VerifyEmailClientComponent from "./verify-email.client";
import { REDIRECT_AFTER_SIGN_IN } from "@/constants";
import { redirectAuthenticatedUser } from "@/utils/auth-redirect";

export const metadata: Metadata = {
  title: "Verify Email",
  description: "Verify your email address",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token;

  await redirectAuthenticatedUser({
    redirectPath: REDIRECT_AFTER_SIGN_IN,
    shouldRedirect: (session) => Boolean(session.user.emailVerified),
  });

  if (!token) {
    return redirect('/sign-in');
  }

  return <VerifyEmailClientComponent />;
}
