import { emailString, v } from "@/lib/validation";
import { passwordVerificationSchema } from "./password.schema";

export const signInSchema = v.object({
  // Matches the central `INVALID_EMAIL_MESSAGE` default exactly; drop the inline
  // override so it falls back to the keyed `Validation.invalidEmail` message.
  email: emailString(),
  password: passwordVerificationSchema,
});

export type SignInSchema = v.InferOutput<typeof signInSchema>;
