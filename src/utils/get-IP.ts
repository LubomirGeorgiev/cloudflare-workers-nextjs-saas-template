import "server-only";

import ipaddr from "ipaddr.js";
import { headers } from "next/headers";

import { TRUSTED_CLIENT_IP_HEADER } from "./trusted-client-ip";

export async function getIP() {
  const headersList = await headers();
  const ip = headersList.get(TRUSTED_CLIENT_IP_HEADER);

  if (!ip || !ipaddr.isValid(ip)) {
    return null
  }

  return ip;
}
