import { emailString, v } from "@/lib/validation";
import { captchaSchema } from "./captcha.schema";

export const forgotPasswordSchema = v.object({
  // Matches the central `INVALID_EMAIL_MESSAGE` default exactly; drop the inline
  // override so it falls back to the keyed `Validation.invalidEmail` message.
  email: emailString(),
  captchaToken: captchaSchema,
});
