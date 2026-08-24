import "server-only";

import { FAQ_ENTRIES, FAQ_MARKUP, FAQ_QUESTION_KEY } from "@/constants/faq";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/translator";
import type { JsonLdNode } from "./json-ld";

// An answer in structured data is plain text, so every rich tag the spec knows resolves to its own
// inner text and the markup is dropped.
const MARKUP_HANDLERS: Record<string, (chunks: string) => string> = Object.fromEntries(
  Object.values(FAQ_MARKUP).map(({ tag }) => [tag, (chunks: string) => chunks]),
);

/**
 * Google retired FAQ rich results in 2023; kept because answer engines read `FAQPage` for an answer.
 */
export async function buildFaqQuestions(locale: Locale): Promise<JsonLdNode[]> {
  const t = await getTranslator({ locale, namespace: "Landing.Faq" });

  return FAQ_ENTRIES.map((entry) => ({
    "@type": "Question",
    name: t(`${entry.key}.${FAQ_QUESTION_KEY}`),
    acceptedAnswer: {
      "@type": "Answer",
      // Newline-joined, not space-joined: the answers are intro-plus-bullets, and running them
      // into one paragraph is exactly what makes an extracted answer unreadable.
      text: entry.answer.map((part) => t.markup(part.key, MARKUP_HANDLERS)).join("\n"),
    },
  }));
}
