import "server-only";

import { env } from "cloudflare:workers";

export function isTestMode(): boolean {
  const testMode = env.APP_TEST_MODE as string | undefined;

  return testMode === "true";
}
