import "server-only";

import { EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS } from "@/constants";
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

  await sendVerificationEmail({
    email,
    verificationToken,
    username,
  });
}
