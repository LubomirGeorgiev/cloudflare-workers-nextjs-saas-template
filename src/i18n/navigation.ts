import {
  permanentRedirect as nextPermanentRedirect,
  redirect as nextRedirect,
} from "next/navigation";

import type { Locale } from "./config";
import { localizeHref } from "./localize-href";

// The locale-aware navigation surface. `Link`/`usePathname`/`useRouter` keep the active locale
// prefix on internal links and on client navigations; `getPathname`/`redirect`/`permanentRedirect`
// do the same for hrefs and redirects built on the server.
export { Link, usePathname, useRouter } from "./navigation.client";

interface RedirectArgs {
  href: string;
  locale: Locale;
}

// The URL that serves `href` in `locale`. Pure, so Workers tests and queue consumers can call it.
export { localizeHref as getPathname } from "./localize-href";

// `next/navigation`'s `redirect`/`permanentRedirect` are typed `never`, but their overloaded
// signature isn't narrow enough for control-flow analysis to treat a call as always throwing.
// Re-typing through a plain `never`-returning wrapper restores narrowing.
export function redirect(args: RedirectArgs): never {
  return nextRedirect(localizeHref(args));
}

export function permanentRedirect(args: RedirectArgs): never {
  return nextPermanentRedirect(localizeHref(args));
}
