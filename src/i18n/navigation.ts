import { createNavigation } from "next-intl/navigation";

import type { Locale } from "./config";
import { routing } from "./routing";

// Only the consumed helpers are re-exported (the linter rejects unused exports).
// `redirect`/`permanentRedirect` preserve the active locale prefix on blog/docs and
// CMS redirects; `Link`/`getPathname` keep it on internal links and hreflang URLs.
const {
  usePathname,
  getPathname,
  Link,
  redirect: intlRedirect,
  permanentRedirect: intlPermanentRedirect,
} = createNavigation(routing);

interface LocalizedRedirectArgs {
  href: string;
  locale: Locale;
}

// next-intl's `redirect`/`permanentRedirect` are typed `never`, but their overloaded
// signature isn't narrow enough for control-flow analysis to treat a call as always
// throwing. Re-typing through a plain `never`-returning wrapper restores narrowing.
function redirect(args: LocalizedRedirectArgs): never {
  return intlRedirect(args as never);
}

function permanentRedirect(args: LocalizedRedirectArgs): never {
  return intlPermanentRedirect(args as never);
}

export { usePathname, getPathname, Link, redirect, permanentRedirect };
