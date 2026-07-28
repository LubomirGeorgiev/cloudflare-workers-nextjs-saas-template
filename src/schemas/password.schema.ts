import { encodeValidationMessage, minMaxString } from "@/lib/validation";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const LEGACY_PASSWORD_MIN_LENGTH = 6;
export const LEGACY_PASSWORD_MAX_LENGTH = 1024;

export const newPasswordSchema = minMaxString({
  min: PASSWORD_MIN_LENGTH,
  max: PASSWORD_MAX_LENGTH,
  minMessage: encodeValidationMessage("passwordMinLength", { min: PASSWORD_MIN_LENGTH }),
  maxMessage: encodeValidationMessage("passwordMaxLength", { max: PASSWORD_MAX_LENGTH }),
});

// Existing accounts could have passwords outside today's creation policy. Preserve those
// credentials while retaining a generous ceiling against abusive verification input.
export const passwordVerificationSchema = minMaxString({
  min: LEGACY_PASSWORD_MIN_LENGTH,
  max: LEGACY_PASSWORD_MAX_LENGTH,
  minMessage: encodeValidationMessage("passwordMinLength", { min: LEGACY_PASSWORD_MIN_LENGTH }),
  maxMessage: encodeValidationMessage("passwordMaxLength", { max: LEGACY_PASSWORD_MAX_LENGTH }),
});
