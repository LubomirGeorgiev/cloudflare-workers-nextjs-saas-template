import { UAParser } from "ua-parser-js";

import type { ParsedUserAgent } from "@/types";

// One narrowing of UAParser's result into the shape the UI renders: sessions, passkeys, and the
// API's session DTO all show the same "which device is this" summary and must not drift apart.
export function parseUserAgent(userAgent: string | null | undefined): ParsedUserAgent {
  const result = new UAParser(userAgent ?? "").getResult();

  return {
    ua: result.ua,
    browser: {
      name: result.browser.name,
      version: result.browser.version,
      major: result.browser.major,
    },
    device: {
      model: result.device.model,
      type: result.device.type,
      vendor: result.device.vendor,
    },
    engine: {
      name: result.engine.name,
      version: result.engine.version,
    },
    os: {
      name: result.os.name,
      version: result.os.version,
    },
  };
}
