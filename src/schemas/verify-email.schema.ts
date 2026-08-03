import { v, validationKey } from "@/lib/validation";
import { tokenField } from "@/schemas/fields";

export const verifyEmailSchema = v.object({
  token: tokenField(validationKey("verificationTokenRequired")),
});
