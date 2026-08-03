import { TEAM_DESCRIPTION_MAX_LENGTH, TEAM_NAME_MAX_LENGTH } from "@/constants";
import { encodeValidationMessage, maxString, trimmedString, v, validationKey } from "@/lib/validation";
import { teamIdField } from "@/schemas/fields";

const TEAM_NAME_REQUIRED_MESSAGE = validationKey("teamNameRequired");

const teamNameField = trimmedString({
  min: 1,
  max: TEAM_NAME_MAX_LENGTH,
  minMessage: TEAM_NAME_REQUIRED_MESSAGE,
  maxMessage: encodeValidationMessage("teamNameMaxLength", { max: TEAM_NAME_MAX_LENGTH }),
});

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
  teamId: teamIdField(),
  name: teamNameField,
});

export type RenameTeamSchema = v.InferOutput<typeof renameTeamSchema>;
