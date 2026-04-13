import { z } from "zod";

const turnstileEnabled = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)

export const captchaSchema = turnstileEnabled
  ? z.string().min(1, 'Please complete the captcha')
  : z.string().optional()
