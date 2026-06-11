import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("react", () => ({
  cache: <T extends (...args: never[]) => unknown>(callback: T) => callback,
}));

vi.mock("@/utils/is-test-mode", () => ({
  isTestMode: () => false,
}));

const originalEnv = process.env;

describe("getPublicConfig", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("returns only public auth feature config", async () => {
    process.env.GOOGLE_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
    process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "turnstile-site-key";
    process.env.TEST_MODE = "false";

    const flags = await import("./flags");

    expect(flags.getPublicConfig).toBeTypeOf("function");
    await expect(flags.getPublicConfig()).resolves.toEqual({
      isGoogleSSOEnabled: true,
      isTurnstileEnabled: true,
      turnstileSiteKey: "turnstile-site-key",
    });
  });
});
