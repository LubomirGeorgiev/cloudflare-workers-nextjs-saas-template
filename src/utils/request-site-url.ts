import "server-only";

import { headers } from "next/headers";

import { SITE_URL } from "@/constants";

import { __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER } from "./request-protocol";

const HTTP_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

// Accepts only a bare http(s) origin: no user info, path, query, or hash.
function parseHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const isBareOrigin = !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;

    return HTTP_PROTOCOLS.has(url.protocol) && isBareOrigin ? url.origin : null;
  } catch {
    return null;
  }
}

// SITE_URL moved to the request host, so a preview deployment links to itself. Vinext refuses a
// server action whose Origin host is not the Host. The fallback reads the Worker-set protocol,
// because a client can spoof `x-forwarded-proto`. No valid origin gives SITE_URL unchanged.
export function resolveRequestSiteUrl({
  requestHeaders,
  siteUrl,
}: {
  requestHeaders: Pick<Headers, "get">;
  siteUrl: string;
}): string {
  const host = requestHeaders.get("host");
  const protocol = requestHeaders.get(__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER);
  const candidate = requestHeaders.get("origin") ?? (host && protocol ? `${protocol}://${host}` : null);
  const origin = candidate ? parseHttpOrigin(candidate) : null;
  if (!origin) {
    return siteUrl;
  }

  const basePath = new URL(siteUrl).pathname.replace(/\/+$/, "");

  return `${origin}${basePath}`;
}

// Only for an App Router request scope: `headers()` throws in the API and MCP handlers.
export async function getRequestSiteUrl(): Promise<string> {
  return resolveRequestSiteUrl({ requestHeaders: await headers(), siteUrl: SITE_URL });
}
