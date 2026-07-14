import { describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE, LOCALES, type Locale } from "./config";

vi.mock("server-only", () => ({}));
const fallbackLocale = DEFAULT_LOCALE;
vi.mock("./locale", () => ({ getUserLocale: vi.fn(async () => fallbackLocale) }));
vi.mock("next-intl/server", () => ({ getRequestConfig: (fn: unknown) => fn }));
vi.mock("./routing", async () => {
  const { LOCALES } = await import("./config");
  return { routing: { locales: LOCALES } };
});
vi.mock("./message-catalogs", async () => {
  const { DEFAULT_LOCALE, LOCALES } = await import("./config");

  return {
    MESSAGE_CATALOGS: Object.fromEntries(
      LOCALES.map((locale) => [
        locale,
        {
          Client: {
            Nav: {
              home: locale === DEFAULT_LOCALE ? "Default home" : "Localized home",
              ...(locale === DEFAULT_LOCALE ? { blog: "Default blog" } : {}),
            },
          },
        },
      ]),
    ),
  };
});

const nonDefaultLocale = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) as Locale;
const requestConfig = (await import("./request")).default as (args: {
  requestLocale: Promise<string | undefined>;
}) => Promise<{
  locale: string;
  messages: {
    Client: {
      Nav: {
        home: string;
        blog: string;
      };
    };
  };
}>;

describe("hybrid request config", () => {
  test("URL locale wins when supported", async () => {
    const { locale } = await requestConfig({ requestLocale: Promise.resolve(nonDefaultLocale) });
    expect(locale).toBe(nonDefaultLocale);
  });
  test("merges default-locale messages under locale-specific messages", async () => {
    const { messages } = await requestConfig({ requestLocale: Promise.resolve(nonDefaultLocale) });

    expect(messages.Client.Nav.home).toBe("Localized home");
    expect(messages.Client.Nav.blog).toBe("Default blog");
  });
  test("falls back to getUserLocale when requestLocale is absent", async () => {
    const { locale } = await requestConfig({ requestLocale: Promise.resolve(undefined) });
    expect(locale).toBe(fallbackLocale);
  });
  test("falls back when requestLocale is unsupported", async () => {
    const { locale } = await requestConfig({ requestLocale: Promise.resolve("zz") });
    expect(locale).toBe(fallbackLocale);
  });
});
