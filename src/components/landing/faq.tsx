import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FAQ_ENTRIES, FAQ_MARKUP, FAQ_QUESTION_KEY } from "@/constants/faq";
import type { FaqAnswerPart, FaqEntry } from "@/constants/faq";
import { MARKDOWN_DIRECTIVES } from "@/constants/markdown-directives";
import { getTranslator } from "@/i18n/translator";
import type { Locale } from "@/i18n/config";

type FaqTranslator = Awaited<ReturnType<typeof getTranslator<"Landing.Faq">>>;

/** Consecutive list parts share one list element; every other part stands on its own. */
interface FaqAnswerBlock {
  key: string;
  list: boolean;
  parts: FaqAnswerPart[];
}

export async function FAQ({ locale }: { locale: Locale }) {
  const t = await getTranslator({ locale, namespace: "Landing.Faq" });

  return (
    <section className="border-t border-border bg-card/40 py-24 sm:py-32">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 lg:px-8">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-edge">
            {t("eyebrow")}
          </p>
          <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            {t("heading")}
          </h2>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">
            {t("description")}
          </p>
        </div>

        {/* `hiddenUntilFound` keeps every answer in the DOM, so find-in-page reaches a closed one
            and so does the `.md` copy of this page. */}
        <Accordion type="single" collapsible hiddenUntilFound className="w-full">
          {FAQ_ENTRIES.map((entry, index) => (
            <AccordionItem key={entry.key} value={`item-${index}`} className="border-border">
              {/* The trigger label is the question itself, not a page action. */}
              <AccordionTrigger
                data-markdown={MARKDOWN_DIRECTIVES.unwrap}
                className="text-left font-display text-base font-medium"
              >
                {t(`${entry.key}.${FAQ_QUESTION_KEY}`)}
              </AccordionTrigger>
              <AccordionContent>
                <div className="prose prose-sm dark:prose-invert w-full max-w-none text-muted-foreground prose-a:text-edge">
                  <FaqAnswer entry={entry} t={t} />
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

export function FaqAnswer({ entry, t }: { entry: FaqEntry; t: FaqTranslator }) {
  const List = entry.listStyle === "number" ? "ol" : "ul";
  const listMarker = entry.listStyle === "number" ? "list-decimal" : "list-disc";

  return (
    <>
      {groupAnswerBlocks(entry.answer).map((block) =>
        block.list ? (
          <List key={block.key} className={`${listMarker} pl-6 mt-2 space-y-1`}>
            {block.parts.map((part) => (
              <li key={part.key}>{renderAnswerPart({ part, t })}</li>
            ))}
          </List>
        ) : (
          <p key={block.key}>{renderAnswerPart({ part: block.parts[0]!, t })}</p>
        ),
      )}
    </>
  );
}

function groupAnswerBlocks(answer: readonly FaqAnswerPart[]): FaqAnswerBlock[] {
  return answer.reduce<FaqAnswerBlock[]>((blocks, part) => {
    const previous = blocks.at(-1);
    if (part.listItem && previous?.list) {
      previous.parts.push(part);
      return blocks;
    }
    blocks.push({ key: part.key, list: Boolean(part.listItem), parts: [part] });
    return blocks;
  }, []);
}

function renderAnswerPart({ part, t }: { part: FaqAnswerPart; t: FaqTranslator }) {
  if (!part.markup) {
    return t(part.key);
  }

  const markup = FAQ_MARKUP[part.markup];
  if (markup.tag === "code") {
    return t.rich(part.key, { code: (chunks) => <code>{chunks}</code> });
  }

  return t.rich(part.key, {
    link: (chunks) => (
      <a href={markup.href} target="_blank" rel="noreferrer">
        {chunks}
      </a>
    ),
  });
}
