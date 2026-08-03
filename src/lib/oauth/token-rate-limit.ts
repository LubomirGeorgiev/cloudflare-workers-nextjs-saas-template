import "server-only";

import { readBoundedRequestBody } from "@/utils/bounded-request-body";

const MAX_INSPECTED_FORM_BYTES = 16 * 1024;
const MAX_GRANT_IDENTITY_PART_LENGTH = 512;
const MAX_PROVIDER_CREDENTIAL_LENGTH = 4 * 1024;
const MAX_CLIENT_ID_LENGTH = 2_048;

interface FormFieldResult {
  state: "absent" | "invalid" | "value";
  value?: string;
}

interface OAuthTokenRateLimitIdentity {
  /** RFC 7009 uses the token endpoint with `token` and no `grant_type`. */
  isRevocationRequest: boolean;
  /** A fixed-size digest only; no OAuth credential or raw client ID leaves this module. */
  fingerprint: string | null;
}

function decodeFormComponent(value: string): string | null {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return null;
  }
}

// The one scan both readers share. Values are yielded still encoded on purpose: the revocation
// check below must never decode or copy a token secret just to establish that one is present.
function* matchingFormFields({
  encodedForm,
  fieldName,
}: {
  encodedForm: string;
  fieldName: string;
}): Generator<{ encodedValue: string | null }> {
  for (const pair of encodedForm.split("&")) {
    const separatorIndex = pair.indexOf("=");
    const encodedName = separatorIndex === -1 ? pair : pair.slice(0, separatorIndex);
    if (decodeFormComponent(encodedName) !== fieldName) {
      continue;
    }

    // `null` = the pair carried no `=` at all, which both readers treat as having no value.
    yield { encodedValue: separatorIndex === -1 ? null : pair.slice(separatorIndex + 1) };
  }
}

function readFormField({
  encodedForm,
  fieldName,
  maxLength,
}: {
  encodedForm: string;
  fieldName: string;
  maxLength: number;
}): FormFieldResult {
  let matchedValue: string | undefined;

  for (const { encodedValue } of matchingFormFields({ encodedForm, fieldName })) {
    // The provider rejects repeated non-resource parameters. Do not build a bucket from a request
    // it will reject, because choosing either duplicate would make the identity ambiguous.
    if (matchedValue !== undefined) {
      return { state: "invalid" };
    }

    const encoded = encodedValue ?? "";
    if (encoded.length > maxLength * 3) {
      return { state: "invalid" };
    }

    const decodedValue = decodeFormComponent(encoded);
    if (decodedValue === null || decodedValue.length > maxLength) {
      return { state: "invalid" };
    }
    matchedValue = decodedValue;
  }

  return matchedValue === undefined
    ? { state: "absent" }
    : { state: "value", value: matchedValue };
}

function hasSingleNonEmptyFormField({
  encodedForm,
  fieldName,
}: {
  encodedForm: string;
  fieldName: string;
}): boolean {
  let hasMatch = false;

  for (const { encodedValue } of matchingFormFields({ encodedForm, fieldName })) {
    if (hasMatch) {
      return false;
    }

    hasMatch = true;
    // Presence is all RFC 7009 classification needs.
    if (!encodedValue) {
      return false;
    }
  }

  return hasMatch;
}

// Null for anything unreadable — wrong content type, over the cap, or not valid UTF-8 — which the
// caller treats as "cannot classify", never as an empty form.
async function readBoundedFormBody(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return null;
  }

  // Do not buffer an attacker-controlled token request merely to improve a soft throttle.
  return (await readBoundedRequestBody({ request, maxBytes: MAX_INSPECTED_FORM_BYTES })).text;
}

function getProviderGrantIdentity(credential: string): string | null {
  const parts = credential.split(":");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return null;
  }
  if (
    parts[0].length > MAX_GRANT_IDENTITY_PART_LENGTH
    || parts[1].length > MAX_GRANT_IDENTITY_PART_LENGTH
  ) {
    return null;
  }

  // The secret is deliberately discarded before hashing. Rotated refresh tokens and the original
  // authorization code therefore share one stable user/grant abuse bucket.
  return `${parts[0]}:${parts[1]}`;
}

async function fingerprintIdentity({
  kind,
  identity,
}: {
  kind: "grant" | "client";
  identity: string;
}): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${kind}\0${identity}`),
  );

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function inspectOAuthTokenRateLimitIdentity(
  request: Request,
): Promise<OAuthTokenRateLimitIdentity> {
  const encodedForm = await readBoundedFormBody(request);
  if (encodedForm === null) {
    return { isRevocationRequest: false, fingerprint: null };
  }

  const grantType = readFormField({
    encodedForm,
    fieldName: "grant_type",
    maxLength: 128,
  });
  if (
    grantType.state === "absent"
    && hasSingleNonEmptyFormField({ encodedForm, fieldName: "token" })
  ) {
    return { isRevocationRequest: true, fingerprint: null };
  }

  const credentialField = grantType.value === "authorization_code"
    ? "code"
    : grantType.value === "refresh_token"
      ? "refresh_token"
      : null;

  if (credentialField) {
    const credential = readFormField({
      encodedForm,
      fieldName: credentialField,
      maxLength: MAX_PROVIDER_CREDENTIAL_LENGTH,
    });
    const grantIdentity = credential.value ? getProviderGrantIdentity(credential.value) : null;
    if (grantIdentity) {
      return {
        isRevocationRequest: false,
        fingerprint: await fingerprintIdentity({ kind: "grant", identity: grantIdentity }),
      };
    }
  }

  const clientId = readFormField({
    encodedForm,
    fieldName: "client_id",
    maxLength: MAX_CLIENT_ID_LENGTH,
  });
  if (clientId.value) {
    return {
      isRevocationRequest: false,
      fingerprint: await fingerprintIdentity({ kind: "client", identity: clientId.value }),
    };
  }

  return { isRevocationRequest: false, fingerprint: null };
}
