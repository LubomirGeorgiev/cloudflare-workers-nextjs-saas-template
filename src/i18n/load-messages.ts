import { lazyValueByKey } from "@/utils/lazy-value";
import { DEFAULT_LOCALE, type Locale } from "./config";
import { loadCatalog, type MessageTree } from "./message-catalogs";

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

// The merged tree for a locale never changes within an isolate, so it is built once per locale and
// held; see `lazyValueByKey` for the contract.
//
// Async because the catalogs are `import()`ed per locale — a statically imported catalog is
// startup cost on every isolate. Deliberately free of `next-intl/server` and `next/headers`: the
// API and MCP entrypoints run outside the App Router graph, where importing either one throws.
export const loadMessages = lazyValueByKey(buildMessages);

// A non-default locale also loads DEFAULT_LOCALE, which the fallback merge needs; the default
// locale itself loads exactly one catalog.
async function buildMessages(locale: Locale): Promise<MessageTree> {
  const messages = await loadCatalog(locale);
  if (locale === DEFAULT_LOCALE) {
    return messages;
  }

  return mergeMessagesWithFallback({
    fallbackMessages: await loadCatalog(DEFAULT_LOCALE),
    messages,
  });
}
