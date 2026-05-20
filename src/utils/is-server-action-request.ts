import "server-only";

import { headers } from "next/headers";

const SERVER_ACTION_HEADERS = ["next-action", "x-rsc-action"] as const;

export async function isServerActionRequest() {
  const headersList = await headers();

  return SERVER_ACTION_HEADERS.some((header) => headersList.has(header));
}
