import "server-only";

import { upsertOAuthApp } from "@/lib/oauth/oauth-apps";

// RFC 7591 registration response, snake_case on the wire.
interface RegistrationResponseBody {
  client_id?: unknown;
  client_name?: unknown;
  logo_uri?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

// Mirrors a successful DCR registration into the D1 `oauth_app` table. The provider has no hook
// for this, so the entrypoint reads it back off the response body — which is why this takes the
// already-parsed JSON rather than a Response. Never throws: mirroring is bookkeeping, and a
// failure here must not turn a successful registration into an error for the client.
export async function mirrorDcrRegistration(body: unknown): Promise<void> {
  try {
    const parsed = body as RegistrationResponseBody;
    const clientId = asString(parsed?.client_id);
    if (!clientId) {
      return;
    }

    await upsertOAuthApp({
      clientId,
      name: asString(parsed.client_name),
      logoUri: asString(parsed.logo_uri),
      redirectUris: Array.isArray(parsed.redirect_uris)
        ? parsed.redirect_uris.filter((uri): uri is string => typeof uri === "string")
        : null,
      tokenEndpointAuthMethod: asString(parsed.token_endpoint_auth_method),
      registrationSource: "dcr",
    });
  } catch (error) {
    console.error("Failed to mirror OAuth client registration into D1", error);
  }
}
