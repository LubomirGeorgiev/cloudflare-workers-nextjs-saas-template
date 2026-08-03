import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";

export const getResetTokenKey = (token: string) => `${APP_KV_PREFIXES.passwordReset}${token}`;
export const getVerificationTokenKey = (token: string) =>
  `${APP_KV_PREFIXES.emailVerification}${token}`;
