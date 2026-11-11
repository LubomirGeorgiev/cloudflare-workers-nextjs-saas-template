import { describe, expect, it } from "vitest";

import type { ParsedUserAgent } from "@/types";
import { selectDeviceParts } from "@/utils/format-device-description";

function parsedUserAgent(parts: Partial<Omit<ParsedUserAgent, "ua">>): ParsedUserAgent {
  return {
    ua: "test-agent",
    browser: {},
    device: {},
    engine: {},
    os: {},
    ...parts,
  };
}

describe("selectDeviceParts", () => {
  it("omits the device when the parser only detects the OS", () => {
    expect(
      selectDeviceParts(
        parsedUserAgent({ browser: { name: "Chrome", major: "157" }, os: { name: "Linux" } }),
      ),
    ).toEqual({ browser: "Chrome 157", platform: "Linux" });
  });

  it("joins the device and the OS when both are known", () => {
    expect(
      selectDeviceParts(
        parsedUserAgent({
          browser: { name: "Safari" },
          device: { vendor: "Apple", model: "iPhone", type: "mobile" },
          os: { name: "iOS", version: "18.1" },
        }),
      ),
    ).toEqual({ browser: "Safari", platform: "Apple iPhone (iOS 18.1)" });
  });

  it("returns null parts so the caller can show its unknown labels", () => {
    expect(selectDeviceParts(undefined)).toEqual({ browser: null, platform: null });
    expect(
      selectDeviceParts(parsedUserAgent({ browser: { major: "157" }, os: { version: "10" } })),
    ).toEqual({ browser: null, platform: null });
  });
});
