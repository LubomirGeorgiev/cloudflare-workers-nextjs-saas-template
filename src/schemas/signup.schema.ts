import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from "@/constants";
import { emailString, minMaxString, v } from "@/lib/validation"
import { captchaSchema } from "./captcha.schema";
import { newPasswordSchema } from "./password.schema";

export const signUpSchema = v.object({
  email: emailString(),
  firstName: minMaxString({ min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH }),
  lastName: minMaxString({ min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH }),
  password: newPasswordSchema,
  captchaToken: captchaSchema,
})

export type SignUpSchema = v.InferOutput<typeof signUpSchema>
