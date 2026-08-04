import { createTranslator } from "next-intl";

import type { Locale } from "./config";
import { loadMessages } from "./load-messages";

// Request-context-free translator for server code that can run outside the App Router — the
// Hono API and the MCP server are plain Worker handlers, where `getTranslations` resolves to
// next-intl's client build and throws. Inside a page/action either one works; this one always
// does, so shared `src/lib/**` services must use it rather than `next-intl/server`.
export async function getTranslator({ locale, namespace }: { locale: Locale; namespace: string }) {
  return createTranslator({ locale, messages: await loadMessages(locale), namespace });
}
