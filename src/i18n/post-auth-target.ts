import { REDIRECT_AFTER_SIGN_IN } from "@/constants";

import { isEnabledLocale, type Locale } from "./config";
import { relocalizeHref } from "./localize-href";

interface ResolvePostAuthTargetArgs {
  redirectPath?: string;
  activeLocale: Locale;
  /** The stored preference a sign-in returned, or `null` when the account has none. */
  preferredLocale?: Locale | null;
}

interface PostAuthTarget {
  /** The target under the prefix of the locale the user ends up in. */
  href: string;
  /** Set only when that locale differs from the locale of the current URL. */
  switchToLocale: Locale | null;
  /** The locale cookie to write: the stored preference when it is served, else `null`. */
  cookieLocale: Locale | null;
}

// The one rule for where a sign-in lands. The URL prefix decides the page locale, so the target
// moves under the prefix of the locale the user ends up in, even when it carries another prefix.
export function resolvePostAuthTarget({
  redirectPath,
  activeLocale,
  preferredLocale,
}: ResolvePostAuthTargetArgs): PostAuthTarget {
  const cookieLocale = isEnabledLocale(preferredLocale) ? preferredLocale : null;
  const targetLocale = cookieLocale ?? activeLocale;

  return {
    href: relocalizeHref({ href: redirectPath || REDIRECT_AFTER_SIGN_IN, locale: targetLocale }),
    switchToLocale: targetLocale === activeLocale ? null : targetLocale,
    cookieLocale,
  };
}
