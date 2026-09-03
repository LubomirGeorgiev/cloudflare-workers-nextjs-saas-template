import { createTranslator } from "next-intl";
import type { Messages, NamespaceKeys, NestedKeyOf } from "next-intl";

import { lazyValueByKey } from "@/utils/lazy-value";
import type { Locale } from "./config";
import { loadMessages } from "./load-messages";

/** Every namespace of the catalog — for helpers that take a namespace as a parameter. */
export type TranslatorNamespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

// `createTranslator` builds a fresh ICU cache on every call, and a translator over inert messages
// holds no request state, so one is held per locale and namespace; see `lazyValueByKey`.
const translatorsForLocale = lazyValueByKey(async (locale: Locale) => {
  const messages = await loadMessages(locale);

  return lazyValueByKey(async (namespace: TranslatorNamespace) =>
    createTranslator({ locale, messages, namespace }),
  );
});

// The one server translator. It needs no request context, so it also works outside the App Router
// — the Hono API and the MCP server are plain Worker handlers, where `getTranslations` resolves to
// next-intl's client build and throws.
export async function getTranslator<
  NestedKey extends TranslatorNamespace = never,
>({ locale, namespace }: { locale: Locale; namespace: NestedKey }) {
  const translators = await translatorsForLocale(locale);

  // The memo is keyed by the whole namespace union, so the caller's namespace is restored here.
  // Pinned to `createTranslator`'s own return type: the underlying `_Translator` is marked private
  // in use-intl, so naming it directly would let a minor upgrade rename it and break the build.
  return (await translators(namespace)) as ReturnType<
    typeof createTranslator<Messages, NestedKey>
  >;
}
