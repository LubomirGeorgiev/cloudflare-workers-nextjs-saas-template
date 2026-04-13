import { z } from "zod";
import { captchaSchema } from "./captcha.schema";

export const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  captchaToken: captchaSchema,
});
