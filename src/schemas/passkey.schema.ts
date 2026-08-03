import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";

import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from "@/constants";
import { emailString, trimmedString, v, validationKey } from "@/lib/validation";
import { idField } from "@/schemas/fields";
import { captchaSchema } from "./captcha.schema";

export const passkeyEmailSchema = v.object({
  // Custom messages here matched the central keyed defaults' meaning exactly; dropped
  // so they fall back to `Validation.invalidEmail` / `Validation.minLength`.
  email: emailString(),
  firstName: trimmedString({ min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH }),
  lastName: trimmedString({ min: NAME_MIN_LENGTH, max: NAME_MAX_LENGTH }),
  captchaToken: captchaSchema,
});

export type PasskeyEmailSchema = v.InferOutput<typeof passkeyEmailSchema>;

// WebAuthn credential payloads come back from the browser API as opaque JSON. They are
// structurally checked here and verified for real against the stored challenge in
// @/utils/webauthn — this schema is a shape gate, not the security boundary.
function webAuthnResponseSchema<T extends AuthenticationResponseJSON | RegistrationResponseJSON>(
  message: string,
) {
  return v.custom<T>(
    (value): value is T =>
      typeof value === "object" && value !== null && "id" in value && "rawId" in value,
    message,
  );
}

export const generateRegistrationOptionsSchema = v.object({
  email: emailString(),
});

export const verifyRegistrationSchema = v.object({
  email: emailString(),
  response: webAuthnResponseSchema<RegistrationResponseJSON>(
    validationKey("invalidRegistrationResponse"),
  ),
});

export const deletePasskeySchema = v.object({
  credentialId: idField(),
});

export const verifyAuthenticationSchema = v.object({
  response: webAuthnResponseSchema<AuthenticationResponseJSON>(
    validationKey("invalidAuthenticationResponse"),
  ),
});

export const completePasskeyRegistrationSchema = v.object({
  response: webAuthnResponseSchema<RegistrationResponseJSON>(
    validationKey("invalidRegistrationResponse"),
  ),
});
