import { emailString, v } from "@/lib/validation";
import { captchaSchema } from "./captcha.schema";

export const forgotPasswordSchema = v.object({
  email: emailString("Please enter a valid email address"),
  captchaToken: captchaSchema,
});
