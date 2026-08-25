import "server-only";

import type {
  ClientRegistrationCallbackOptions,
  ClientRegistrationCallbackResult,
} from "@cloudflare/workers-oauth-provider";

import { isLoopbackHost } from "@/lib/oauth/client-identity";
import { readBoundedRequestBody } from "@/utils/bounded-request-body";

// Open DCR is intentionally anonymous, so bound every piece of metadata the provider persists or
// reflects. These limits are generous for agent clients while keeping a single registration cheap.
const MAX_DCR_REQUEST_BYTES = 16 * 1024;
const MAX_DCR_REDIRECT_URIS = 10;
const MAX_DCR_URI_LENGTH = 2_048;
const MAX_DCR_CLIENT_NAME_LENGTH = 200;
const MAX_DCR_CONTACTS = 10;
const MAX_DCR_CONTACT_LENGTH = 320;
const MAX_DCR_PROTOCOL_VALUES = 10;
const MAX_DCR_PROTOCOL_VALUE_LENGTH = 128;

const URI_METADATA_FIELDS = new Set([
  "client_uri",
  "logo_uri",
  "policy_uri",
  "tos_uri",
  "jwks_uri",
]);
const PROTOCOL_ARRAY_FIELDS = ["grant_types", "response_types"] as const;
// RFC 7591 human-readable metadata may repeat with a `#lang` suffix. `jwks_uri` is machine-only,
// so it is validated in its canonical form but deliberately has no localized twin.
const LOCALIZABLE_METADATA_FIELDS = new Set([
  "client_name",
  "client_uri",
  "logo_uri",
  "policy_uri",
  "tos_uri",
]);

function rejectMetadata({
  description,
  status,
}: {
  description: string;
  status?: number;
}): ClientRegistrationCallbackResult {
  return { code: "invalid_client_metadata", description, ...(status ? { status } : {}) };
}

function rejectRedirect(description: string): ClientRegistrationCallbackResult {
  return { code: "invalid_redirect_uri", description };
}

function parseDcrUri({
  field,
  value,
  allowsFragment,
}: {
  field: string;
  value: string;
  allowsFragment: boolean;
}): { error: string } | { parsed: URL } {
  if (value.length > MAX_DCR_URI_LENGTH) {
    return { error: `${field} must be at most ${MAX_DCR_URI_LENGTH} characters` };
  }
  if (value !== value.trim()) {
    return { error: `${field} must not contain surrounding whitespace` };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { error: `${field} must be an absolute URI` };
  }

  if (parsed.username || parsed.password) {
    return { error: `${field} must not contain credentials` };
  }
  if (!allowsFragment && parsed.hash) {
    return { error: `${field} must not contain a fragment` };
  }

  return { parsed };
}

function usesAllowedWebScheme({
  parsed,
  allowsLoopbackHttp,
}: {
  parsed: URL;
  allowsLoopbackHttp: boolean;
}): boolean {
  if (parsed.protocol === "https:") {
    return true;
  }

  return allowsLoopbackHttp && parsed.protocol === "http:" && isLoopbackHost(parsed.hostname);
}

function validateSafeUri({
  field,
  value,
  allowsLoopbackHttp,
  allowsFragment,
}: {
  field: string;
  value: string;
  allowsLoopbackHttp: boolean;
  allowsFragment: boolean;
}): string | null {
  const result = parseDcrUri({ field, value, allowsFragment });
  if ("error" in result) {
    return result.error;
  }
  if (usesAllowedWebScheme({ parsed: result.parsed, allowsLoopbackHttp })) {
    return null;
  }

  return `${field} must use https, or http on a loopback host`;
}

function validateStringArray({
  metadata,
  field,
  maxItems,
  maxItemLength,
}: {
  metadata: Record<string, unknown>;
  field: string;
  maxItems: number;
  maxItemLength: number;
}): ClientRegistrationCallbackResult | null {
  const value = metadata[field];
  if (!Array.isArray(value)) {
    return null;
  }
  if (value.length > maxItems) {
    return rejectMetadata({ description: `${field} must contain at most ${maxItems} values` });
  }
  if (value.some((item) => typeof item === "string" && item.length > maxItemLength)) {
    return rejectMetadata({
      description: `${field} values must be at most ${maxItemLength} characters`,
    });
  }

  return null;
}

function validateRedirectUris(
  metadata: Record<string, unknown>,
): ClientRegistrationCallbackResult | null {
  const redirectUris = metadata.redirect_uris;
  if (!Array.isArray(redirectUris)) {
    return null;
  }
  if (redirectUris.length > MAX_DCR_REDIRECT_URIS) {
    return rejectRedirect(`redirect_uris must contain at most ${MAX_DCR_REDIRECT_URIS} values`);
  }

  for (const redirectUri of redirectUris) {
    if (typeof redirectUri !== "string") {
      continue;
    }
    const error = validateSafeUri({
      field: "redirect_uris",
      value: redirectUri,
      allowsLoopbackHttp: true,
      allowsFragment: false,
    });
    if (error) {
      return rejectRedirect(error);
    }
  }

  return null;
}

/** How a metadata key is bounded, resolving `field#lang` to the rule for its canonical twin. */
function displayFieldKind(field: string): "name" | "uri" | null {
  if (field === "client_name") {
    return "name";
  }
  if (URI_METADATA_FIELDS.has(field)) {
    return "uri";
  }

  const [base, lang, ...extra] = field.split("#");
  if (!lang || extra.length > 0 || !LOCALIZABLE_METADATA_FIELDS.has(base)) {
    return null;
  }

  return base === "client_name" ? "name" : "uri";
}

// One pass over every key, so a canonical field and its localized variants can never drift apart —
// forgetting one was previously only possible because they were validated by two separate loops.
function validateDisplayMetadata(
  metadata: Record<string, unknown>,
): ClientRegistrationCallbackResult | null {
  for (const [field, value] of Object.entries(metadata)) {
    if (typeof value !== "string") {
      continue;
    }

    const kind = displayFieldKind(field);
    if (!kind) {
      continue;
    }

    if (kind === "name") {
      if (value.length > MAX_DCR_CLIENT_NAME_LENGTH) {
        return rejectMetadata({
          description: `${field} must be at most ${MAX_DCR_CLIENT_NAME_LENGTH} characters`,
        });
      }
      continue;
    }

    const error = validateSafeUri({
      field,
      value,
      allowsLoopbackHttp: true,
      allowsFragment: true,
    });
    if (error) {
      return rejectMetadata({ description: error });
    }
  }

  return null;
}

async function exceedsRequestSize(request: Request): Promise<boolean> {
  return (await readBoundedRequestBody({ request, maxBytes: MAX_DCR_REQUEST_BYTES })).exceededLimit;
}

// Runs after the provider's RFC 7591 shape checks but before it stores the client in KV.
// fallow-ignore-next-line unused-export -- Reached through a lazy `import()` in provider-config.ts.
export async function validateDcrRegistration({
  clientMetadata,
  request,
}: ClientRegistrationCallbackOptions): Promise<ClientRegistrationCallbackResult | void> {
  if (await exceedsRequestSize(request)) {
    return rejectMetadata({
      description: `Registration payload must be at most ${MAX_DCR_REQUEST_BYTES} bytes`,
      status: 413,
    });
  }

  const redirectError = validateRedirectUris(clientMetadata);
  if (redirectError) {
    return redirectError;
  }

  const displayMetadataError = validateDisplayMetadata(clientMetadata);
  if (displayMetadataError) {
    return displayMetadataError;
  }

  const contactsError = validateStringArray({
    metadata: clientMetadata,
    field: "contacts",
    maxItems: MAX_DCR_CONTACTS,
    maxItemLength: MAX_DCR_CONTACT_LENGTH,
  });
  if (contactsError) {
    return contactsError;
  }

  for (const field of PROTOCOL_ARRAY_FIELDS) {
    const error = validateStringArray({
      metadata: clientMetadata,
      field,
      maxItems: MAX_DCR_PROTOCOL_VALUES,
      maxItemLength: MAX_DCR_PROTOCOL_VALUE_LENGTH,
    });
    if (error) {
      return error;
    }
  }

  const authMethod = clientMetadata.token_endpoint_auth_method;
  if (typeof authMethod === "string" && authMethod.length > MAX_DCR_PROTOCOL_VALUE_LENGTH) {
    return rejectMetadata({
      description: `token_endpoint_auth_method must be at most ${MAX_DCR_PROTOCOL_VALUE_LENGTH} characters`,
    });
  }
}
