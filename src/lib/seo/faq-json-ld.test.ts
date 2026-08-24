import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { FaqAnswer } from "@/components/landing/faq";
import { FAQ_ENTRIES, FAQ_QUESTION_KEY } from "@/constants/faq";
import { ENABLED_LOCALES } from "@/i18n/config";
import { getTranslator } from "@/i18n/translator";

vi.mock("server-only", () => ({}));

const { buildFaqQuestions } = await import("./faq-json-ld");

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
};

// The rendered answer as a reader reads it: element boundaries and escaping carry no content.
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => HTML_ENTITIES[entity]!);
}

async function loadFaqCatalog(locale: string): Promise<Record<string, Record<string, string>>> {
  const messages = (await import(`@/i18n/messages/${locale}.json`)).default;

  return messages.Landing.Faq;
}

// Structured data that describes content the accordion does not render is a policy violation, and
// a specification the catalog does not cover throws at request time. Both drift silently.
describe.each(ENABLED_LOCALES)("landing FAQ content model (%s)", (locale) => {
  test("the specification lists exactly the answer parts the catalog holds, in catalog order", async () => {
    const faq = await loadFaqCatalog(locale);

    for (const entry of FAQ_ENTRIES) {
      const catalogParts = Object.keys(faq[entry.key]!)
        .filter((key) => key !== FAQ_QUESTION_KEY)
        .map((key) => `${entry.key}.${key}`);

      expect(catalogParts.length).toBeGreaterThan(0);
      expect(entry.answer.map((part) => part.key)).toEqual(catalogParts);
    }
  });

  test("answers the same parts the accordion renders, in the same order", async () => {
    const t = await getTranslator({ locale, namespace: "Landing.Faq" });
    const questions = await buildFaqQuestions(locale);

    FAQ_ENTRIES.forEach((entry, index) => {
      const answer = (questions[index]!.acceptedAnswer as { text: string }).text;

      expect(answer.split("\n")).toHaveLength(entry.answer.length);
      // Rich tags resolve to their inner text rather than reaching the payload as markup.
      expect(answer).not.toMatch(/<\/?[a-z]/i);
      expect(visibleText(renderToStaticMarkup(FaqAnswer({ entry, t })))).toBe(
        answer.replaceAll("\n", ""),
      );
    });
  });

  test("names every entry with the question the accordion trigger shows", async () => {
    const faq = await loadFaqCatalog(locale);
    const questions = await buildFaqQuestions(locale);

    expect(questions).toHaveLength(FAQ_ENTRIES.length);
    FAQ_ENTRIES.forEach((entry, index) => {
      expect(questions[index]!.name).toBe(faq[entry.key]![FAQ_QUESTION_KEY]);
    });
  });
});
