import { describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE } from "./config";

vi.mock("server-only", () => ({}));
const fallbackLocale = DEFAULT_LOCALE;
vi.mock("./locale", () => ({ getUserLocale: vi.fn(async () => fallbackLocale) }));
vi.mock("next-intl/server", () => ({ getRequestConfig: (fn: unknown) => fn }));
vi.mock("./routing", () => ({ routing: { locales: ["en", "es"] } }));
vi.mock("./messages/en.json", () => ({
  default: {
    Client: {
      Nav: {
        home: "Home",
        blog: "Blog",
      },
    },
  },
}));
vi.mock("./messages/es.json", () => ({
  default: {
    Client: {
      Nav: {
        home: "Inicio",
      },
    },
  },
}));

const nonDefaultLocale = "es";
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

    expect(messages.Client.Nav.home).toBe("Inicio");
    expect(messages.Client.Nav.blog).toBe("Blog");
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
