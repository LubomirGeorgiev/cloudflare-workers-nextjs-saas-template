import "server-only";

import { isEnabledLocale, type Locale } from "./config";
import { getLocale } from "./server";

interface NewAccountLocaleInput {
  /** The locale the sign-up started in, when the flow crossed a bare URL (Google SSO). Untrusted. */
  entryLocale?: string | null;
}

/**
 * The locale a new account stores as its preference: the one the visitor signed up in.
 * Later sign-ins apply it.
 * Every sign-up path calls this, so the password, passkey, and Google flows cannot disagree.
 */
export async function getNewAccountLocale({ entryLocale }: NewAccountLocaleInput = {}): Promise<Locale> {
  if (isEnabledLocale(entryLocale)) {
    return entryLocale;
  }

  return getLocale();
}
