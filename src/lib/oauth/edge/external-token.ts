import "server-only";

import type { ApiKeyBearerProps } from "@/lib/oauth/bearer-props";
import { getApiKeyPrincipal } from "@/utils/kv-api-key";

// The single auth funnel's API-key half: a bearer token that is not one of the provider's own gets
// one chance to be recognized as an API key. Returning props authenticates the request; null yields
// the provider's standard `invalid_token` response, including the RFC 9728 discovery header.
// fallow-ignore-next-line unused-export -- Reached through a lazy `import()` in worker-entrypoint.ts.
export async function resolveApiKeyToken(
  token: string,
): Promise<{ props: ApiKeyBearerProps } | null> {
  const principal = await getApiKeyPrincipal(token);

  if (!principal) {
    return null;
  }

  return { props: { credentialKind: "api-key", principal } satisfies ApiKeyBearerProps };
}
