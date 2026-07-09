import { requiredString, v, validationKey } from "@/lib/validation";

export const verifyEmailSchema = v.object({
  token: requiredString(validationKey("verificationTokenRequired")),
});
