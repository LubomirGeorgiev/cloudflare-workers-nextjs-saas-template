import { describe, expect, test } from "vitest";

import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALE_COOKIE_NAME } from "./config";
import { routing } from "./routing";

// The as-needed prefix contract is SEO-critical: default locale served at the bare
// path, others prefixed. We assert the routing configuration (the prefixing behavior
// itself is next-intl's, validated at runtime by the Task 1 spike). Values derive from
// config for template safety.
describe("routing configuration", () => {
  test("uses as-needed locale prefixing", () => {
    const prefix = routing.localePrefix;
    // next-intl may store this as the string or a normalized { mode } object.
    const mode = typeof prefix === "string" ? prefix : prefix?.mode;
    expect(mode).toBe("as-needed");
  });

  test("locales and default come from i18n config", () => {
    // Routing serves the enabled set, which collapses to just the default locale
    // when i18n is disabled — assert against that, not the full LOCALES catalog.
    expect(routing.locales).toEqual(ENABLED_LOCALES);
    expect(routing.defaultLocale).toBe(DEFAULT_LOCALE);
  });

  test("uses the shared locale cookie name", () => {
    expect(routing.localeCookie).toMatchObject({
      name: LOCALE_COOKIE_NAME,
    });
  });
});
