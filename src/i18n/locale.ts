import "server-only";

import { cookies, headers } from "next/headers";

import { I18N_ENABLED } from "@/constants";
import { getSessionFromCookie } from "@/utils/auth";
import {
  DEFAULT_LOCALE,
  ENABLED_LOCALES,
  LOCALE_COOKIE_NAME,
  type Locale,
} from "./config";

// Validate against the served set, not the full catalog: when I18N_ENABLED is
// false, ENABLED_LOCALES collapses to [DEFAULT_LOCALE], so every resolution path
// below structurally falls back to the default without a special-case guard.
function isSupportedLocale(value: string | undefined | null): value is Locale {
  return ENABLED_LOCALES.includes(value as Locale);
}

// Pick the best supported locale from an Accept-Language header, honoring the
// client's quality-value ordering (e.g. "es-ES,es;q=0.9,en;q=0.8").
function matchAcceptLanguage(header: string | null): Locale | undefined {
  if (!header) {
    return undefined;
  }

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const quality = qParam ? Number.parseFloat(qParam.split("=")[1]) : 1;
      return { tag: tag.trim().toLowerCase(), quality: Number.isNaN(quality) ? 0 : quality };
    })
    .filter((entry) => entry.tag)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isSupportedLocale(base)) {
      return base;
    }
  }

  return undefined;
}

// Resolve the active locale for the current request: an explicit cookie wins,
// then the authenticated user's stored preference, then Accept-Language
// negotiation, otherwise fall back to the default.
export async function getUserLocale(): Promise<Locale> {
  // Perf short-circuit: in single-locale mode isSupportedLocale already rejects
  // everything but DEFAULT_LOCALE, so this only skips the cookie/session/header
  // reads — correctness no longer depends on it.
  if (!I18N_ENABLED) {
    return DEFAULT_LOCALE;
  }

  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (isSupportedLocale(fromCookie)) {
    return fromCookie;
  }

  // Authenticated users fall back to their stored preference before header negotiation.
  const session = await getSessionFromCookie();
  const preferred = session?.user?.preferredLocale;
  if (isSupportedLocale(preferred)) {
    return preferred;
  }

  const headerStore = await headers();
  return matchAcceptLanguage(headerStore.get("accept-language")) ?? DEFAULT_LOCALE;
}
