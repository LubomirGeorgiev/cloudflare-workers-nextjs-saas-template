import type { Locale } from "./config";
import { localizedPathname } from "./localized-pathname";

// The current page under another locale. `usePathname()` drops the query and the hash, so
// the caller passes them back in. They are required, not optional: a dropped `?redirect=`
// strands the visitor after sign-in, and a required parameter makes the caller supply it.
export function buildLocaleHref({
  pathname,
  locale,
  search,
  hash,
}: {
  pathname: string;
  locale: Locale;
  search: string;
  hash: string;
}): string {
  return localizedPathname({ pathname, locale }) + search + hash;
}
