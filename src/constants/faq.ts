import type { Messages } from "next-intl";

import { GITHUB_REPO_URL } from "@/constants";

type FaqCatalog = Messages["Landing"]["Faq"];

/** The entries of `Landing.Faq`: every key whose value is a question object, not a string. */
type FaqEntryKey = {
  [K in keyof FaqCatalog]: FaqCatalog[K] extends string ? never : K;
}[keyof FaqCatalog] &
  string;

/** Every leaf key of an entry, such as `techStack.item1` — what a translator accepts. */
type FaqMessageKey = {
  [K in keyof FaqCatalog]: FaqCatalog[K] extends string
    ? never
    : `${K & string}.${keyof FaqCatalog[K] & string}`;
}[keyof FaqCatalog];

/** The sub-key every entry uses for its question; the other sub-keys are its answer parts. */
export const FAQ_QUESTION_KEY = "question";

/**
 * Rich tags an answer part can carry. The tag name is the catalog's, the destination is ours, so a
 * fork retargets a link once instead of in both renderers.
 */
export const FAQ_MARKUP = {
  repo: { tag: "link", href: GITHUB_REPO_URL },
  readme: { tag: "link", href: `${GITHUB_REPO_URL}/blob/main/README.md` },
  code: { tag: "code" },
} as const;

type FaqMarkupKind = keyof typeof FAQ_MARKUP;

export interface FaqAnswerPart {
  key: FaqMessageKey;
  /** Renders as one entry of the answer's list instead of as a paragraph. */
  listItem?: true;
  markup?: FaqMarkupKind;
}

export interface FaqEntry {
  key: FaqEntryKey;
  /** Numbered when the list items are steps to follow in order. */
  listStyle?: "bullet" | "number";
  answer: readonly FaqAnswerPart[];
}

/**
 * The landing-page FAQ, in render order, with the ordered parts of every answer. The accordion in
 * `src/components/landing/faq.tsx` and the `FAQPage` markup in `src/lib/seo/faq-json-ld.ts` both
 * iterate this list, so a part reaches the page and the markup together, or neither.
 */
export const FAQ_ENTRIES: readonly FaqEntry[] = [
  {
    key: "isFree",
    answer: [{ key: "isFree.answer", markup: "repo" }],
  },
  {
    key: "featuresIncluded",
    answer: [
      { key: "featuresIncluded.intro" },
      { key: "featuresIncluded.item1", listItem: true },
      { key: "featuresIncluded.item2", listItem: true },
      { key: "featuresIncluded.item3", listItem: true },
      { key: "featuresIncluded.item4", listItem: true },
      { key: "featuresIncluded.item5", listItem: true },
      { key: "featuresIncluded.item6", listItem: true },
      { key: "featuresIncluded.item7", listItem: true },
      { key: "featuresIncluded.item8", listItem: true },
      { key: "featuresIncluded.item9", listItem: true },
      { key: "featuresIncluded.item10", listItem: true },
      { key: "featuresIncluded.item11", listItem: true },
      { key: "featuresIncluded.item12", listItem: true },
    ],
  },
  {
    key: "techStack",
    answer: [
      { key: "techStack.intro" },
      { key: "techStack.item1", listItem: true },
      { key: "techStack.item2", listItem: true },
      { key: "techStack.item3", listItem: true },
      { key: "techStack.item4", listItem: true },
      { key: "techStack.item5", listItem: true },
      { key: "techStack.item6", listItem: true },
      { key: "techStack.item7", listItem: true },
      { key: "techStack.item8", listItem: true },
    ],
  },
  {
    key: "deploy",
    listStyle: "number",
    answer: [
      { key: "deploy.intro" },
      { key: "deploy.item1", listItem: true },
      { key: "deploy.item2", listItem: true },
      { key: "deploy.item3", listItem: true },
      { key: "deploy.item4", listItem: true },
      { key: "deploy.item5", listItem: true },
      { key: "deploy.item6", listItem: true },
      { key: "deploy.outro", markup: "repo" },
    ],
  },
  {
    key: "gettingStarted",
    answer: [
      { key: "gettingStarted.paragraph1" },
      { key: "gettingStarted.paragraph2", markup: "readme" },
    ],
  },
  {
    key: "roadmap",
    answer: [
      { key: "roadmap.intro" },
      { key: "roadmap.item1", listItem: true },
      { key: "roadmap.item2", listItem: true },
      { key: "roadmap.item3", listItem: true },
      { key: "roadmap.item4", listItem: true },
      { key: "roadmap.item5", listItem: true },
      { key: "roadmap.item6", listItem: true },
      { key: "roadmap.item7", listItem: true },
      { key: "roadmap.item8", listItem: true },
      { key: "roadmap.item9", listItem: true },
    ],
  },
  {
    key: "emailTemplates",
    answer: [{ key: "emailTemplates.answer" }],
  },
  {
    key: "customize",
    answer: [
      { key: "customize.intro" },
      { key: "customize.item1", listItem: true, markup: "code" },
      { key: "customize.item2", listItem: true, markup: "code" },
      { key: "customize.item3", listItem: true, markup: "code" },
    ],
  },
  {
    key: "contribute",
    answer: [{ key: "contribute.answer", markup: "repo" }],
  },
];
