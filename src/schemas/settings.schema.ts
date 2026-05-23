import { minString, v } from "@/lib/validation";

export const userSettingsSchema = v.object({
  firstName: minString(2, "First name must be at least 2 characters."),
  lastName: minString(2, "Last name must be at least 2 characters."),
});
