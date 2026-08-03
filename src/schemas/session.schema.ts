import { v } from "@/lib/validation";
import { idField, sessionIdField } from "@/schemas/fields";

export const updateSelectedTeamSchema = v.object({
  selectedTeam: v.optional(idField()),
});

export const deleteSessionSchema = v.object({
  sessionId: sessionIdField(),
});
