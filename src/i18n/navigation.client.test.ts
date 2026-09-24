import { type ComponentProps, type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE, ENABLED_LOCALES, type Locale } from "./config";
import { Link, usePathname, useRouter } from "./navigation.client";
import { AppIntlProvider } from "./provider";

const nextNavigation = vi.hoisted(() => ({
  pathname: "/",
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => nextNavigation.pathname,
  useRouter: () => ({
    push: nextNavigation.push,
    replace: nextNavigation.replace,
    prefetch: nextNavigation.prefetch,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const NON_DEFAULT_LOCALE = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);
const PAGE_PATH = "/blog";

function renderInLocale({ locale, element }: { locale: Locale; element: ReactElement }) {
  const props = { locale, messages: {}, children: element };

  return renderToStaticMarkup(createElement(AppIntlProvider, props));
}

function linkHref({ locale, href }: { locale: Locale; href: string }) {
  const markup = renderInLocale({ locale, element: createElement(Link, { href }, "link") });

  return markup.match(/href="([^"]*)"/)?.[1];
}

function readPathname(): string {
  let pathname = "";

  function Probe() {
    pathname = usePathname();
    return null;
  }

  renderInLocale({ locale: DEFAULT_LOCALE, element: createElement(Probe) });

  return pathname;
}

function captureRouter(locale: Locale): ReturnType<typeof useRouter> {
  let router: ReturnType<typeof useRouter> | undefined;

  function Probe() {
    router = useRouter();
    return null;
  }

  renderInLocale({ locale, element: createElement(Probe) });

  return router!;
}

beforeEach(() => {
  nextNavigation.pathname = "/";
  vi.clearAllMocks();
});

describe("usePathname", () => {
  test("returns a bare path unchanged", () => {
    nextNavigation.pathname = PAGE_PATH;

    expect(readPathname()).toBe(PAGE_PATH);
  });

  test.skipIf(NON_DEFAULT_LOCALE === undefined)("strips a served locale prefix", () => {
    nextNavigation.pathname = `/${NON_DEFAULT_LOCALE}${PAGE_PATH}`;
    expect(readPathname()).toBe(PAGE_PATH);

    nextNavigation.pathname = `/${NON_DEFAULT_LOCALE}`;
    expect(readPathname()).toBe("/");
  });
});

describe("Link", () => {
  test("keeps an in-app path bare in the default locale", () => {
    expect(linkHref({ locale: DEFAULT_LOCALE, href: PAGE_PATH })).toBe(PAGE_PATH);
  });

  test.skipIf(NON_DEFAULT_LOCALE === undefined)(
    "prefixes an in-app path in a non-default locale",
    () => {
      const locale = NON_DEFAULT_LOCALE!;

      expect(linkHref({ locale, href: PAGE_PATH })).toBe(`/${locale}${PAGE_PATH}`);
      expect(linkHref({ locale, href: "/" })).toBe(`/${locale}`);
      expect(linkHref({ locale, href: `${PAGE_PATH}?page=2` })).toBe(
        `/${locale}${PAGE_PATH}?page=2`,
      );
    },
  );

  test.skipIf(NON_DEFAULT_LOCALE === undefined)(
    "passes through external, relative, and already-prefixed hrefs",
    () => {
      const locale = NON_DEFAULT_LOCALE!;
      const passThrough = [
        "https://example.com/blog",
        "//example.com/blog",
        "mailto:someone@example.com",
        "relative/path",
        "#section",
        `/${locale}${PAGE_PATH}`,
      ];

      for (const href of passThrough) {
        expect(linkHref({ locale, href })).toBe(href);
      }
    },
  );

  test("refuses a UrlObject href at the type level", () => {
    // @ts-expect-error A `UrlObject` would skip `localizeHref` and lose the locale prefix.
    const props: ComponentProps<typeof Link> = { href: { pathname: PAGE_PATH } };

    expect(props.href).toEqual({ pathname: PAGE_PATH });
  });
});

describe("useRouter", () => {
  test("keeps the default locale bare and passes options through", () => {
    const router = captureRouter(DEFAULT_LOCALE);
    const options = { scroll: false };

    router.push(PAGE_PATH, options);
    router.replace(PAGE_PATH);

    expect(nextNavigation.push).toHaveBeenCalledWith(PAGE_PATH, options);
    expect(nextNavigation.replace).toHaveBeenCalledWith(PAGE_PATH, undefined);
  });

  test.skipIf(NON_DEFAULT_LOCALE === undefined)(
    "localizes push, replace, and prefetch in a non-default locale",
    () => {
      const locale = NON_DEFAULT_LOCALE!;
      const router = captureRouter(locale);
      const options = { scroll: false };
      const expected = `/${locale}${PAGE_PATH}`;

      router.push(PAGE_PATH, options);
      router.replace(PAGE_PATH, options);
      router.prefetch(PAGE_PATH);
      router.push("https://example.com/blog");

      expect(nextNavigation.push).toHaveBeenCalledWith(expected, options);
      expect(nextNavigation.replace).toHaveBeenCalledWith(expected, options);
      expect(nextNavigation.prefetch).toHaveBeenCalledWith(expected, undefined);
      expect(nextNavigation.push).toHaveBeenLastCalledWith("https://example.com/blog", undefined);
    },
  );
});
