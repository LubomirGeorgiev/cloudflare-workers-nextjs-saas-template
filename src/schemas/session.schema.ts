import { v } from "@/lib/validation";

export const updateSelectedTeamSchema = v.object({
  selectedTeam: v.optional(v.string()),
});

export const deleteSessionSchema = v.object({
  sessionId: v.string(),
});
