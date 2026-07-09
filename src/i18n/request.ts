import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, type Locale } from "./config";
import { getUserLocale } from "./locale";
import { MESSAGE_CATALOGS, type MessageTree } from "./message-catalogs";
import { routing } from "./routing";

function isMessageTree(value: unknown): value is MessageTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Deep-merge the default-locale catalog under the active one so keys missing from a translation fall back
// to DEFAULT_LOCALE instead of rendering the raw key path. next-intl has no built-in cross-locale fallback;
// this is the recommended pattern. Active-locale values always win; recursion only descends when both sides are subtrees.
function mergeMessagesWithFallback({
  fallbackMessages,
  messages,
}: {
  fallbackMessages: MessageTree;
  messages: MessageTree;
}): MessageTree {
  const merged: MessageTree = { ...fallbackMessages };

  for (const [key, value] of Object.entries(messages)) {
    const fallbackValue = fallbackMessages[key];

    merged[key] =
      isMessageTree(fallbackValue) && isMessageTree(value)
        ? mergeMessagesWithFallback({ fallbackMessages: fallbackValue, messages: value })
        : value;
  }

  return merged;
}

// The catalogs are static module imports, so the merged tree for a given locale never
// changes within a Worker isolate. Cache it to avoid re-merging the full tree on every
// request; the isolate is reused across requests, so this runs at most once per locale.
const mergedMessagesCache = new Map<Locale, MessageTree>();

function loadMessages(locale: Locale): MessageTree {
  const messages = MESSAGE_CATALOGS[locale];
  if (locale === DEFAULT_LOCALE) return messages;

  const cached = mergedMessagesCache.get(locale);
  if (cached) return cached;

  const merged = mergeMessagesWithFallback({
    fallbackMessages: MESSAGE_CATALOGS[DEFAULT_LOCALE],
    messages,
  });
  mergedMessagesCache.set(locale, merged);

  return merged;
}

// Hybrid config. On locale-prefixed public routes, `requestLocale` is the [locale] URL
// segment and wins. On the cookie-based app/API surface it is undefined, so we fall back
// to getUserLocale() (cookie -> user.preferredLocale -> Accept-Language -> default).
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : await getUserLocale();

  return {
    locale,
    messages: loadMessages(locale),
  };
});
