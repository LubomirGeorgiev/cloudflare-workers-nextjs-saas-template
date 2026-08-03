import { CAPTCHA_TOKEN_MAX_LENGTH } from "@/constants";
import { maxString, v } from "@/lib/validation";

export const captchaSchema = v.optional(maxString(CAPTCHA_TOKEN_MAX_LENGTH))
