import { emailString, minMaxString, v } from "@/lib/validation";
import { captchaSchema } from "./captcha.schema";

export const passkeyEmailSchema = v.object({
  email: emailString("Please enter a valid email address"),
  firstName: minMaxString({ min: 2, max: 255, minMessage: "First name must be at least 2 characters" }),
  lastName: minMaxString({ min: 2, max: 255, minMessage: "Last name must be at least 2 characters" }),
  captchaToken: captchaSchema,
});

export type PasskeyEmailSchema = v.InferOutput<typeof passkeyEmailSchema>;
