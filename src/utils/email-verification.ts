import "server-only";

import { EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS } from "@/constants";
import { getUserLocale } from "@/i18n/locale";
import { getVerificationTokenKey } from "@/utils/auth-utils";
import { sendVerificationEmail } from "@/utils/email";
import { createId } from "@paralleldrive/cuid2";
import { createExpiringToken } from "@/utils/kv-token";

interface SendUserVerificationEmailParams {
  userId: string;
  email: string;
  username: string;
}

export async function sendUserVerificationEmail({
  userId,
  email,
  username,
}: SendUserVerificationEmailParams) {
  const verificationToken = await createExpiringToken({
    key: getVerificationTokenKey,
    expiresInSeconds: EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS,
    payload: {
      userId,
    },
    createToken: createId,
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
