import { createTranslator } from "use-intl/core";
import type { Messages, NamespaceKeys, NestedKeyOf } from "use-intl/core";

import { lazyValueByKey } from "@/utils/lazy-value";
import { DEFAULT_TIME_ZONE, type Locale } from "./config";
import { loadCatalog } from "./message-catalogs";

/** Every namespace of the catalog — for helpers that take a namespace as a parameter. */
export type TranslatorNamespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

// `createTranslator` builds a fresh ICU cache on every call, and a translator over inert messages
// holds no request state, so one is held per locale and namespace; see `lazyValueByKey`.
const translatorsForLocale = lazyValueByKey(async (locale: Locale) => {
  const messages = await loadCatalog(locale);

  // An undefined namespace is the root one, which `getTranslations()` with no argument asks for.
  // The time zone matches `AppIntlProvider`, so a server-formatted date reads the same as the client.
  return lazyValueByKey(async (namespace: TranslatorNamespace | undefined) =>
    createTranslator({ locale, messages, namespace, timeZone: DEFAULT_TIME_ZONE }),
  );
});

// The one server translator. It needs no request context, so it also works outside the App Router
// — the Hono API and the MCP server are plain Worker handlers, where `cookies()` and `headers()`
// throw, so `getTranslations` from `@/i18n/server` cannot run.
export async function getTranslator<
  NestedKey extends TranslatorNamespace = never,
>({ locale, namespace }: { locale: Locale; namespace?: NestedKey }) {
  const translators = await translatorsForLocale(locale);

  // The memo is keyed by the whole namespace union, so the caller's namespace is restored here.
  // Pinned to `createTranslator`'s own return type: the underlying `_Translator` is marked private
  // in use-intl, so naming it directly would let a minor upgrade rename it and break the build.
  return (await translators(namespace)) as ReturnType<
    typeof createTranslator<Messages, NestedKey>
  >;
}
