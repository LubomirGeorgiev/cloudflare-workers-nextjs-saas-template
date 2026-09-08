import "server-only";

import type { ClientNamespace } from "./client-namespaces";
import type { Locale } from "./config";
import { loadMessages } from "./load-messages";
import type { MessageTree } from "./message-catalogs";

// Copy `namespaces` (dotted paths) out of `source`, keeping the catalog's nesting.
function pickNamespaces({
  namespaces,
  source,
}: {
  namespaces: readonly string[];
  source: MessageTree;
}): MessageTree {
  const picked: MessageTree = {};

  for (const namespace of namespaces) {
    const segments = namespace.split(".");
    let from = source;
    let into = picked;

    for (const segment of segments.slice(0, -1)) {
      from = from[segment] as MessageTree;
      into = (into[segment] ??= {}) as MessageTree;
    }

    const leaf = segments[segments.length - 1];
    into[leaf] = from[leaf];
  }

  return picked;
}

// Every `NextIntlClientProvider` serializes what it receives into the RSC payload, so a provider
// takes only the namespaces its own subtree reads — see `CLIENT_MESSAGE_SCOPES`. Server-only copy
// stays out of the browser because the `client-translations-under-client-namespace` oxlint rule
// keeps every client string under `Client.*`.
//
// `locale` is required on purpose: next-intl's own `getMessages()` works it out by reading request
// headers, and that marks the render dynamic. Callers pass the locale they took from the URL
// segment or the user's cookie.
export async function getClientMessages({
  locale,
  namespaces,
}: {
  locale: Locale;
  namespaces: readonly ClientNamespace[];
}) {
  const messages = await loadMessages(locale);

  return {
    // The pick keeps the catalog's shape for the subtrees it copies, which the index-signature
    // walk above cannot express.
    Client: pickNamespaces({ namespaces, source: messages.Client }) as Partial<
      typeof messages.Client
    >,
  };
}
