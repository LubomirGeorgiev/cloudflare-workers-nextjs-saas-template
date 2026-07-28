import { NAME_MIN_LENGTH } from "@/constants";
import { minString, v } from "@/lib/validation";

export const userSettingsSchema = v.object({
  // Custom messages restated the generic min-length rule; dropped so they fall back
  // to the central keyed `Validation.minLength` default.
  firstName: minString(NAME_MIN_LENGTH),
  lastName: minString(NAME_MIN_LENGTH),
});
