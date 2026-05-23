import { emailString, minMaxString, minString, v } from "@/lib/validation"
import { captchaSchema } from "./captcha.schema";

export const signUpSchema = v.object({
  email: emailString(),
  firstName: minMaxString({ min: 2, max: 255 }),
  lastName: minMaxString({ min: 2, max: 255 }),
  password: minString(6),
  captchaToken: captchaSchema,
})

export type SignUpSchema = v.InferOutput<typeof signUpSchema>
