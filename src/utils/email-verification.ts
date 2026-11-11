import "server-only";

import { EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS } from "@/constants";
import { getUserLocale } from "@/i18n/locale";
import { getSafeRedirectPath } from "@/utils/auth-redirect";
import { getVerificationTokenKey } from "@/utils/auth-utils";
import { sendVerificationEmail } from "@/utils/email";
import { createExpiringToken, type ExpiringTokenPayload } from "@/utils/kv-token";

// `returnTo` is absent on tokens from before it existed, and on flows with no return path.
export interface EmailVerificationTokenPayload extends ExpiringTokenPayload {
  returnTo?: string;
}

interface SendUserVerificationEmailParams {
  userId: string;
  email: string;
  username: string;
  /** Client input. It goes into the token, never into the email URL. */
  returnTo?: string;
}

export async function sendUserVerificationEmail({
  userId,
  email,
  username,
  returnTo,
}: SendUserVerificationEmailParams) {
  const verificationToken = await createExpiringToken<EmailVerificationTokenPayload>({
    key: getVerificationTokenKey,
    expiresInSeconds: EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS,
    payload: {
      userId,
      returnTo: returnTo ? getSafeRedirectPath({ value: returnTo }) : undefined,
    },
  });

  // All callers run inside a request (server actions), so getUserLocale()
  // (cookie -> preferredLocale -> Accept-Language -> default) resolves here as a
  // single choke point instead of threading locale through every call site.
  const locale = await getUserLocale();

  await sendVerificationEmail({
    email,
    verificationToken,
    username,
    locale,
  });
}
