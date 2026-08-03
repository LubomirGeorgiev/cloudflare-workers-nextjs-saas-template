import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from "@/constants";
import { emailString, trimmedString, v } from "@/lib/validation"
import { captchaSchema } from "./captcha.schema";
import { newPasswordSchema } from "./password.schema";

export const signUpSchema = v.object({
  email: emailString(),
  firstName: trimmedString({ min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH }),
  lastName: trimmedString({ min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH }),
  password: newPasswordSchema,
  captchaToken: captchaSchema,
})

export type SignUpSchema = v.InferOutput<typeof signUpSchema>
