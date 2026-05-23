import { requiredString, v } from "@/lib/validation";

export const teamInviteSchema = v.object({
  token: requiredString("Invitation token is required"),
});
