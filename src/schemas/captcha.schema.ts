import { requiredString, v } from "@/lib/validation";

const turnstileEnabled = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)

export const captchaSchema = turnstileEnabled
  ? requiredString('Please complete the captcha')
  : v.optional(v.string())
