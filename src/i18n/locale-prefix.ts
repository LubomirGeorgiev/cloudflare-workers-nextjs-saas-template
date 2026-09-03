import { LOCALES } from "./config";

// The bare path behind a locale-prefixed one, or `null` when the path carries no prefix. Checks the
// full LOCALES catalog, not just the enabled set, so paths for disabled locales are caught too.
export function stripLocalePrefix(pathname: string): string | null {
  for (const locale of LOCALES) {
    if (pathname === `/${locale}`) {
      return "/";
    }
    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1);
    }
  }
  return null;
}
