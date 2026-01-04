import { z } from "zod"
import { captchaSchema } from "./captcha.schema";

export const signUpSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(2).max(255),
  lastName: z.string().min(2).max(255),
  password: z.string().min(6),
  captchaToken: captchaSchema,
})

export type SignUpSchema = z.infer<typeof signUpSchema>
