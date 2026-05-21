import "server-only";

import { EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS } from "@/constants";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import { getVerificationTokenKey } from "@/utils/auth-utils";
import { sendVerificationEmail } from "@/utils/email";
import { createId } from "@paralleldrive/cuid2";

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
  const { env } = await getCloudflareContext();

  if (!env?.NEXT_INC_CACHE_KV) {
    throw new Error("Can't connect to KV store");
  }

  const verificationToken = createId();
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_EXPIRATION_SECONDS * 1000);

  await env.NEXT_INC_CACHE_KV.put(
    getVerificationTokenKey(verificationToken),
    JSON.stringify({
      userId,
      expiresAt: expiresAt.toISOString(),
    }),
    {
      expirationTtl: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    }
  );

  await sendVerificationEmail({
    email,
    verificationToken,
    username,
  });
}
