import {
  BLOCKED_EMAIL_PATTERN_MAX_LENGTH,
  BLOCKED_EMAIL_REASON_MAX_LENGTH,
} from "@/constants";
import {
  encodeValidationMessage,
  maxString,
  minMaxString,
  v,
  validationKey,
} from "@/lib/validation";
import { adminTablePaginationFields, idField } from "@/schemas/fields";
import { isValidEmailPattern } from "@/utils/email-pattern";

// The single declaration of what a blocklist entry is. The add dialog, the server action, and the
// internal route all spread these fields, so the accepted pattern format exists once in the
// codebase and the form can never accept a shape the matcher would not recognise.
export const createBlockedEmailFields = {
  // One flat pipe rather than `minMaxString(...)` wrapped in a check: `bounded-strings.test.ts`
  // reads the bound off this node's own actions, and a nested pipe hides it from that walk.
  // `isValidEmailPattern` is the same parser the service stores from and the matcher reads with,
  // and it runs last so an oversized value trips the length rule first.
  pattern: v.pipe(
    v.string(),
    v.trim(),
    v.minLength(1, validationKey("required")),
    v.maxLength(
      BLOCKED_EMAIL_PATTERN_MAX_LENGTH,
      encodeValidationMessage("maxLength", { max: BLOCKED_EMAIL_PATTERN_MAX_LENGTH }),
    ),
    v.check(isValidEmailPattern, validationKey("invalidEmailPattern")),
  ),
  reason: v.optional(maxString(BLOCKED_EMAIL_REASON_MAX_LENGTH)),
};

export const createBlockedEmailSchema = v.object(createBlockedEmailFields);

export const deleteBlockedEmailSchema = v.object({
  id: idField("Blocked email ID is required"),
});

export const getBlockedEmailsSchema = v.object({
  ...adminTablePaginationFields,
});

/** The add dialog's preview: how many existing accounts a pattern would have matched. */
export const countMatchingUsersSchema = v.object({
  pattern: minMaxString({ min: 1, max: BLOCKED_EMAIL_PATTERN_MAX_LENGTH }),
});

export type CreateBlockedEmailSchema = v.InferOutput<typeof createBlockedEmailSchema>;
