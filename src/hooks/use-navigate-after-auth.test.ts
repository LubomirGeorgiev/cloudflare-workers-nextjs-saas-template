import { afterEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/i18n/config";
import { resolvePostAuthTarget } from "@/i18n/post-auth-target";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  enterLocale: vi.fn(),
  fetchSession: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  writeLocaleCookie: vi.fn(),
}));

vi.mock("@/hooks/use-fetch-session", () => ({
  useFetchSession: () => mocks.fetchSession,
}));

vi.mock("@/i18n/client", () => ({
  useLocale: () => DEFAULT_LOCALE,
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/i18n/locale-cookie.client", () => ({
  enterLocale: mocks.enterLocale,
  writeLocaleCookie: mocks.writeLocaleCookie,
}));

const { useNavigateAfterAuth } = await import("./use-navigate-after-auth");

const NON_DEFAULT_LOCALE = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);

describe("useNavigateAfterAuth", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("loads the session store before the soft navigation", () => {
    mocks.fetchSession.mockImplementation(() => {
      mocks.calls.push("fetchSession");
    });
    mocks.push.mockImplementation(() => {
      mocks.calls.push("push");
    });
    mocks.calls.length = 0;

    useNavigateAfterAuth()({ redirectPath: "/settings" });

    const { href } = resolvePostAuthTarget({ redirectPath: "/settings", activeLocale: DEFAULT_LOCALE });

    expect(mocks.fetchSession).toHaveBeenCalledWith({ reason: "mutation" });
    expect(mocks.push).toHaveBeenCalledWith(href);
    expect(mocks.calls).toEqual(["fetchSession", "push"]);
  });

  test.skipIf(!NON_DEFAULT_LOCALE)("does not fetch the session when a locale switch loads a new document", () => {
    useNavigateAfterAuth()({ preferredLocale: NON_DEFAULT_LOCALE });

    expect(mocks.enterLocale).toHaveBeenCalledOnce();
    expect(mocks.fetchSession).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
