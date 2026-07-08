import { minString, v } from "@/lib/validation";

export const userSettingsSchema = v.object({
  // Custom messages restated the generic min-length rule; dropped so they fall back
  // to the central keyed `Validation.minLength` default.
  firstName: minString(2),
  lastName: minString(2),
});
