import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from "@/constants";
import { emailString, minMaxString, v } from "@/lib/validation";
import { captchaSchema } from "./captcha.schema";

export const passkeyEmailSchema = v.object({
  // Custom messages here matched the central keyed defaults' meaning exactly; dropped
  // so they fall back to `Validation.invalidEmail` / `Validation.minLength`.
  email: emailString(),
  firstName: minMaxString({ min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH }),
  lastName: minMaxString({ min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH }),
  captchaToken: captchaSchema,
});

export type PasskeyEmailSchema = v.InferOutput<typeof passkeyEmailSchema>;
