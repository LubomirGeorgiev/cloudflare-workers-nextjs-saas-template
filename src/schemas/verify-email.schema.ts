import { v, validationKey } from "@/lib/validation";
import { returnToField, tokenField } from "@/schemas/fields";

export const verifyEmailSchema = v.object({
  token: tokenField(validationKey("verificationTokenRequired")),
});

export const sendVerificationSchema = v.object({
  returnTo: returnToField(),
});
