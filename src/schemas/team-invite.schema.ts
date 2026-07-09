import { requiredString, v, validationKey } from "@/lib/validation";

export const teamInviteSchema = v.object({
  token: requiredString(validationKey("invitationTokenRequired")),
});
