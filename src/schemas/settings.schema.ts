import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from "@/constants";
import { trimmedString, v } from "@/lib/validation";

export const userSettingsSchema = v.object({
  // Custom messages restated the generic length rules; dropped so they fall back
  // to the central keyed `Validation.minLength` / `Validation.maxLength` defaults.
  firstName: trimmedString({ min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH }),
  lastName: trimmedString({ min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH }),
});

export type UserSettingsSchema = v.InferOutput<typeof userSettingsSchema>;
