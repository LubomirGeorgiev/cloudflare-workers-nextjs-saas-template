import { describe, expect, test } from "vitest";

import { REDIRECT_AFTER_SIGN_IN } from "@/constants";

import { DEFAULT_LOCALE, ENABLED_LOCALES } from "./config";
import { localizedPathname } from "./localized-pathname";
import { resolvePostAuthTarget } from "./post-auth-target";

// Derived, not hard-coded: a fork changes the catalog, and a locale switch only exists while more
// than one locale is served.
const NON_DEFAULT_LOCALE = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);

describe("resolvePostAuthTarget", () => {
  test("changes nothing for an account without a stored preference", () => {
    expect(
      resolvePostAuthTarget({
        redirectPath: "/settings?tab=profile",
        activeLocale: DEFAULT_LOCALE,
        preferredLocale: null,
      }),
    ).toEqual({ href: "/settings?tab=profile", switchToLocale: null, cookieLocale: null });
  });

  test("falls back to the default target", () => {
    expect(resolvePostAuthTarget({ activeLocale: DEFAULT_LOCALE })).toEqual({
      href: REDIRECT_AFTER_SIGN_IN,
      switchToLocale: null,
      cookieLocale: null,
    });
  });

  test("writes the cookie and navigates softly when the preference is the active locale", () => {
    expect(
      resolvePostAuthTarget({
        redirectPath: "/dashboard",
        activeLocale: DEFAULT_LOCALE,
        preferredLocale: DEFAULT_LOCALE,
      }),
    ).toEqual({ href: "/dashboard", switchToLocale: null, cookieLocale: DEFAULT_LOCALE });
  });

  test("ignores a preference that is not served, for the cookie too", () => {
    expect(
      resolvePostAuthTarget({
        redirectPath: "/dashboard",
        activeLocale: DEFAULT_LOCALE,
        // @ts-expect-error a de-served or legacy value from the DB
        preferredLocale: "zz",
      }),
    ).toEqual({ href: "/dashboard", switchToLocale: null, cookieLocale: null });
  });

  test.skipIf(!NON_DEFAULT_LOCALE)("moves the target under the preferred locale's prefix", () => {
    const preferredLocale = NON_DEFAULT_LOCALE!;

    expect(
      resolvePostAuthTarget({
        redirectPath: "/dashboard?tab=1#top",
        activeLocale: DEFAULT_LOCALE,
        preferredLocale,
      }),
    ).toEqual({
      href: `${localizedPathname({ pathname: "/dashboard", locale: preferredLocale })}?tab=1#top`,
      switchToLocale: preferredLocale,
      cookieLocale: preferredLocale,
    });
  });

  test.skipIf(!NON_DEFAULT_LOCALE)("replaces a locale prefix the target already carries", () => {
    const activeLocale = NON_DEFAULT_LOCALE!;
    const prefixedTarget = localizedPathname({ pathname: "/settings", locale: activeLocale });

    expect(
      resolvePostAuthTarget({
        redirectPath: prefixedTarget,
        activeLocale,
        preferredLocale: DEFAULT_LOCALE,
      }),
    ).toEqual({
      href: localizedPathname({ pathname: "/settings", locale: DEFAULT_LOCALE }),
      switchToLocale: DEFAULT_LOCALE,
      cookieLocale: DEFAULT_LOCALE,
    });
  });

  // The cookie and the page must agree: an English account must not land on a Spanish page.
  test.skipIf(!NON_DEFAULT_LOCALE)(
    "moves another locale's prefix to the active locale when the preference matches it",
    () => {
      const redirectPath = localizedPathname({
        pathname: "/dashboard",
        locale: NON_DEFAULT_LOCALE!,
      });

      expect(
        resolvePostAuthTarget({
          redirectPath,
          activeLocale: DEFAULT_LOCALE,
          preferredLocale: DEFAULT_LOCALE,
        }),
      ).toEqual({
        href: localizedPathname({ pathname: "/dashboard", locale: DEFAULT_LOCALE }),
        switchToLocale: null,
        cookieLocale: DEFAULT_LOCALE,
      });
    },
  );

  test.skipIf(!NON_DEFAULT_LOCALE)(
    "moves another locale's prefix to the active locale when there is no preference",
    () => {
      const activeLocale = NON_DEFAULT_LOCALE!;

      expect(
        resolvePostAuthTarget({
          redirectPath: localizedPathname({
            pathname: "/dashboard",
            locale: DEFAULT_LOCALE,
            forcePrefix: true,
          }),
          activeLocale,
          preferredLocale: null,
        }),
      ).toEqual({
        href: localizedPathname({ pathname: "/dashboard", locale: activeLocale }),
        switchToLocale: null,
        cookieLocale: null,
      });
    },
  );

  test.skipIf(!NON_DEFAULT_LOCALE)("uses the default target under the preferred locale", () => {
    const preferredLocale = NON_DEFAULT_LOCALE!;

    expect(
      resolvePostAuthTarget({ activeLocale: DEFAULT_LOCALE, preferredLocale }).href,
    ).toBe(localizedPathname({ pathname: REDIRECT_AFTER_SIGN_IN, locale: preferredLocale }));
  });

  test("the cookie locale matches every locale switch", () => {
    const targets = ENABLED_LOCALES.flatMap((activeLocale) =>
      [...ENABLED_LOCALES, null].map((preferredLocale) =>
        resolvePostAuthTarget({ redirectPath: "/dashboard", activeLocale, preferredLocale }),
      ),
    );
    const switches = targets.filter((target) => target.switchToLocale !== null);

    expect(switches.every((target) => target.cookieLocale === target.switchToLocale)).toBe(true);
  });
});
