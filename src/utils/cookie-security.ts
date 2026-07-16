import "server-only";

import { headers } from "next/headers";

import isProd from "./is-prod";
import { __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER } from "./request-protocol";

export async function shouldUseSecureCookies(): Promise<boolean> {
  if (!isProd) {
    return false;
  }

  const requestProtocol = (await headers()).get(__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER);

  // The Worker replaces this header from Request.url, so clients cannot downgrade
  // cookie security by spoofing forwarding headers.
  return requestProtocol !== "http";
}
