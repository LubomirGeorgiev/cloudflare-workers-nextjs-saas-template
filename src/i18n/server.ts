import "server-only";

import { cache } from "react";

import type { Locale } from "./config";
import { getUserLocale } from "./locale";
import { getTranslator, type TranslatorNamespace } from "./translator";

// The request-scoped half of the i18n layer. Only the App Router has a request scope, so shared
// `src/lib/**` and `src/utils/**` services take `getTranslator` from `./translator` instead;
// `src/lib/api/shared-service-imports.test.ts` enforces that split.

type RequestTranslator<NestedKey extends TranslatorNamespace = never> = Awaited<
  ReturnType<typeof getTranslator<NestedKey>>
>;

/**
 * The locale of the current request, memoized per render. `getUserLocale()` holds the precedence,
 * so a page and a direct caller such as an email sender cannot disagree.
 */
export const getLocale: () => Promise<Locale> = cache(() => getUserLocale());

/** A translator over the whole catalog, for a key built at runtime. */
export function getTranslations(): Promise<RequestTranslator>;
/** A translator bound to one namespace, in the locale of the current request. */
export function getTranslations<NestedKey extends TranslatorNamespace>(
  namespace: NestedKey,
): Promise<RequestTranslator<NestedKey>>;
/** The same, in an explicit locale — for a response whose language the caller chose. */
export function getTranslations<NestedKey extends TranslatorNamespace>(options: {
  locale?: Locale;
  namespace?: NestedKey;
}): Promise<RequestTranslator<NestedKey>>;
export async function getTranslations<NestedKey extends TranslatorNamespace>(
  namespaceOrOptions?: NestedKey | { locale?: Locale; namespace?: NestedKey },
) {
  const options =
    typeof namespaceOrOptions === "string"
      ? { namespace: namespaceOrOptions }
      : (namespaceOrOptions ?? {});

  return getTranslator({
    locale: options.locale ?? (await getLocale()),
    namespace: options.namespace,
  });
}
