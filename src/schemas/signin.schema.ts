import { emailString, encodeValidationMessage, minString, v } from "@/lib/validation";

export const signInSchema = v.object({
  // Matches the central `INVALID_EMAIL_MESSAGE` default exactly; drop the inline
  // override so it falls back to the keyed `Validation.invalidEmail` message.
  email: emailString(),
  password: minString(8, encodeValidationMessage("passwordMinLength", { min: 8 })),
});

export type SignInSchema = v.InferOutput<typeof signInSchema>;
