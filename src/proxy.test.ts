import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";

import {
  DEFAULT_LOCALE,
  ENABLED_LOCALES,
  LOCALE_COOKIE_NAME,
  LOCALE_DETECTION,
  LOCALE_HEADER_NAME,
} from "@/i18n/config";
import { localizedPathname } from "@/i18n/localized-pathname";

import proxy from "./proxy";

const MIDDLEWARE_OVERRIDE_HEADERS = "x-middleware-override-headers";
const SPOOFED_LOCALE = "spoofed";
const ALTERNATE_LOCALE = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);
const DOCUMENT_HEADERS = { accept: "text/html", "sec-fetch-dest": "document" } as const;

function proxyWithSpoofedLocale(pathname: string) {
  return proxy(
    new NextRequest(
      new Request(`https://example.com${pathname}`, {
        headers: { [LOCALE_HEADER_NAME]: SPOOFED_LOCALE },
      }),
    ),
  );
}

// `getLocale()` trusts the forwarded header, so an exit that skips locale routing must drop it.
describe("proxy pass-through exits", () => {
  test.each([
    ["a non-localized path", "/api/v1/openapi.json"],
    ["an undecodable path", "/%E0%A4%A"],
  ])("drops a client-sent locale header on %s", (_label, pathname) => {
    const proxied = proxyWithSpoofedLocale(pathname);
    const overridden = proxied.headers.get(MIDDLEWARE_OVERRIDE_HEADERS)?.split(",") ?? [];

    expect(proxied.headers.get("x-middleware-next")).toBe("1");
    expect(overridden.length).toBeGreaterThan(0);
    expect(overridden).not.toContain(LOCALE_HEADER_NAME);
    expect(proxied.headers.get(`x-middleware-request-${LOCALE_HEADER_NAME}`)).toBeNull();
  });
});

function proxyDocument({
  pathname,
  headers = {},
}: {
  pathname: string;
  headers?: Record<string, string>;
}) {
  return proxy(
    new NextRequest(
      new Request(`https://example.com${pathname}`, {
        headers: { ...DOCUMENT_HEADERS, ...headers },
      }),
    ),
  );
}

function redirectPathname(response: Response): string | null {
  const location = response.headers.get("location");

  return location === null ? null : new URL(location).pathname;
}

// The locale cookie means "the visitor chose this locale". Only the switcher writes it; the proxy
// reads it to pick the locale of a bare path, and never writes it back.
describe("proxy and the locale cookie", () => {
  test("writes no cookie on a bare path with no locale signal", () => {
    expect(proxyDocument({ pathname: "/blog" }).headers.getSetCookie()).toEqual([]);
  });

  describe.runIf(ALTERNATE_LOCALE !== undefined && LOCALE_DETECTION)("with a second served locale", () => {
    const alternate = ALTERNATE_LOCALE!;
    const alternatePath = localizedPathname({ pathname: "/blog", locale: alternate });

    test.each([
      ["no cookie", {}],
      ["a cookie for the default locale", { cookie: `${LOCALE_COOKIE_NAME}=${DEFAULT_LOCALE}` }],
    ])("writes no cookie on a prefixed page with %s", (_label, headers) => {
      const response = proxyDocument({ pathname: alternatePath, headers });

      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.getSetCookie()).toEqual([]);
    });

    test("sends a bare path to the locale the cookie names", () => {
      const response = proxyDocument({
        pathname: "/",
        headers: { cookie: `${LOCALE_COOKIE_NAME}=${alternate}`, "accept-language": DEFAULT_LOCALE },
      });

      expect(redirectPathname(response)).toBe(localizedPathname({ pathname: "/", locale: alternate }));
      expect(response.headers.getSetCookie()).toEqual([]);
    });

    test("sends a bare path to the Accept-Language locale without writing a cookie", () => {
      const response = proxyDocument({
        pathname: "/",
        headers: { "accept-language": `${alternate}-XX,${alternate};q=0.9` },
      });

      expect(redirectPathname(response)).toBe(localizedPathname({ pathname: "/", locale: alternate }));
      expect(response.headers.getSetCookie()).toEqual([]);
    });
  });
});
