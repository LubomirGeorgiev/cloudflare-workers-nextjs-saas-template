import { emailString, minMaxString, v } from "@/lib/validation"
import { captchaSchema } from "./captcha.schema";
import { newPasswordSchema } from "./password.schema";

export const signUpSchema = v.object({
  email: emailString(),
  firstName: minMaxString({ min: 2, max: 255 }),
  lastName: minMaxString({ min: 2, max: 255 }),
  password: newPasswordSchema,
  captchaToken: captchaSchema,
})

export type SignUpSchema = v.InferOutput<typeof signUpSchema>
