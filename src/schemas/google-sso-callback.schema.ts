import { requiredString, v } from "@/lib/validation";

export const googleSSOCallbackSchema = v.object({
  code: requiredString("Authorization code is required"),
  state: requiredString("State parameter is required"),
});
