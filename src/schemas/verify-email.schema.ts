import { requiredString, v } from "@/lib/validation";

export const verifyEmailSchema = v.object({
  token: requiredString("Verification token is required"),
});
