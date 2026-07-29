import { TEAM_DESCRIPTION_MAX_LENGTH, TEAM_NAME_MAX_LENGTH } from "@/constants";
import { encodeValidationMessage, maxString, requiredString, v, validationKey } from "@/lib/validation";

const TEAM_NAME_REQUIRED_MESSAGE = validationKey("teamNameRequired");

// Trim runs before the emptiness check: `requiredString()` is string + minLength(1), so
// composing it with a later trim would let a whitespace-only name through as "".
const teamNameField = v.pipe(
  v.string(TEAM_NAME_REQUIRED_MESSAGE),
  v.trim(),
  v.minLength(1, TEAM_NAME_REQUIRED_MESSAGE),
  v.maxLength(TEAM_NAME_MAX_LENGTH, encodeValidationMessage("teamNameMaxLength", { max: TEAM_NAME_MAX_LENGTH })),
);

const teamDescriptionField = maxString(
  TEAM_DESCRIPTION_MAX_LENGTH,
  encodeValidationMessage("descriptionMaxLength", { max: TEAM_DESCRIPTION_MAX_LENGTH }),
);

// No `avatarUrl`: team avatars have no UI yet, and `createTeam` writes whatever it is given
// straight to an <img src> rendered for every member. Add it back with the upload flow.
export const createTeamSchema = v.object({
  name: teamNameField,
  description: v.optional(teamDescriptionField),
});

export type CreateTeamSchema = v.InferOutput<typeof createTeamSchema>;

export const renameTeamSchema = v.object({
  teamId: requiredString(validationKey("teamIdRequired")),
  name: teamNameField,
});

export type RenameTeamSchema = v.InferOutput<typeof renameTeamSchema>;
