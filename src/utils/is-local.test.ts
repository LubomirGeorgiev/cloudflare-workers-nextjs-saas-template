import { afterEach, describe, expect, test, vi } from "vitest";

import { LOCAL_HOSTNAMES } from "@/constants";

const PUBLIC_SITE_URL = "https://app.example.com";

async function loadIsLocalMode({ siteUrl, localMode }: { siteUrl: string; localMode?: string }) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", siteUrl);
  vi.stubEnv("NEXT_PUBLIC_APP_LOCAL_MODE", localMode);

  return (await import("./is-local")).isLocalMode;
}

describe("isLocalMode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("is on for every local site URL", async () => {
    for (const hostname of LOCAL_HOSTNAMES) {
      expect(await loadIsLocalMode({ siteUrl: `http://${hostname}:3000` })).toBe(true);
    }
  });

  test("is off for a public site URL when the opt-in is unset or not true", async () => {
    for (const localMode of [undefined, "", "false", "1"]) {
      expect(await loadIsLocalMode({ siteUrl: PUBLIC_SITE_URL, localMode })).toBe(false);
    }
  });

  test("is on for a public site URL with the opt-in", async () => {
    expect(await loadIsLocalMode({ siteUrl: PUBLIC_SITE_URL, localMode: "true" })).toBe(true);
  });
});
