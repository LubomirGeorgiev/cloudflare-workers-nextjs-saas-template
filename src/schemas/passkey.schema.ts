import { emailString, minMaxString, v } from "@/lib/validation";
import { captchaSchema } from "./captcha.schema";

export const passkeyEmailSchema = v.object({
  // Custom messages here matched the central keyed defaults' meaning exactly; dropped
  // so they fall back to `Validation.invalidEmail` / `Validation.minLength`.
  email: emailString(),
  firstName: minMaxString({ min: 2, max: 255 }),
  lastName: minMaxString({ min: 2, max: 255 }),
  captchaToken: captchaSchema,
});

export type PasskeyEmailSchema = v.InferOutput<typeof passkeyEmailSchema>;
