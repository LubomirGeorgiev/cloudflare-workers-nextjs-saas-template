import "server-only";

import type { JSONContent } from "@tiptap/core";

import { getCloudflareContext } from "@/utils/cloudflare-context";
import { LOCALE_LABELS, type Locale } from "@/i18n/config";
import type { TranslatableEntryField } from "@/types/cms";
import { runAiText, type AiBinding } from "@/lib/ai/generate-text";
import { truncateSeoDescription } from "@/lib/cms/seo-description";
import { ALERT_BLOCK_NODE_NAME } from "@/components/tiptap-node/alert-block/alert-block-types";

// The model NEVER sees the ProseMirror/TipTap structure. We deep-clone the doc,
// collect only the human-readable leaf strings, translate that flat list, and
// write each translation back into its original node. Node types, nesting,
// marks, links (href) and images (src) are preserved by construction — a bad
// model response degrades to a verbatim copy, never a broken document.

// A translate function takes a flat list of strings and returns the same number
// of strings in the same order. Injectable so the extract/reinject logic can be
// unit-tested without Cloudflare AI.
type TranslateStringsFn = (values: string[]) => Promise<string[]>;

interface CollectedStrings {
  values: string[];
  setters: Array<(value: string) => void>;
}

// Batch bounds per AI call — keeps each request small and predictable.
const TRANSLATE_CHUNK_MAX_ITEMS = 40;
const TRANSLATE_CHUNK_MAX_CHARS = 3000;
// How many content chunks to translate concurrently. Bounded to keep large
// documents from bursting past Workers-AI rate limits.
const TRANSLATE_CHUNK_CONCURRENCY = 4;
const TRANSLATE_MAX_TOKENS = 4096;

function pushField(
  obj: Record<string, unknown>,
  key: string,
  collected: CollectedStrings
): void {
  const current = obj[key];
  if (typeof current === "string" && current.trim().length > 0) {
    collected.values.push(current);
    collected.setters.push((value) => {
      obj[key] = value;
    });
  }
}

// Mirrors extractNodeText's knowledge of which fields are human-readable text:
// text nodes, image alt, and the alert-block title/body. Skips code (code blocks
// and inline `code` marks) so snippets are copied verbatim, not translated.
export function collectTranslatableStrings(content: JSONContent): CollectedStrings {
  const collected: CollectedStrings = { values: [], setters: [] };

  function visit(node: JSONContent | undefined, canTranslateText: boolean): void {
    if (!node || typeof node !== "object") return;

    const isCodeBlock = node.type === "codeBlock";

    if (typeof node.text === "string" && canTranslateText) {
      const hasCodeMark =
        Array.isArray(node.marks) && node.marks.some((mark) => mark?.type === "code");
      if (!hasCodeMark) {
        pushField(node as Record<string, unknown>, "text", collected);
      }
    }

    if (node.type === "image" && node.attrs && typeof node.attrs === "object") {
      pushField(node.attrs as Record<string, unknown>, "alt", collected);
    }

    if (node.type === ALERT_BLOCK_NODE_NAME && node.attrs && typeof node.attrs === "object") {
      pushField(node.attrs as Record<string, unknown>, "title", collected);
      pushField(node.attrs as Record<string, unknown>, "body", collected);
    }

    if (Array.isArray(node.content)) {
      node.content.forEach((child) => visit(child, canTranslateText && !isCodeBlock));
    }
  }

  visit(content, true);
  return collected;
}

// Falls back to the source strings unless `parsed` is a same-length array;
// per-item, keeps the source when an entry is missing or not a string. This is
// the structural safety net: a malformed model response can only ever yield a
// verbatim copy.
export function reconcileTranslation(source: string[], parsed: unknown): string[] {
  if (!Array.isArray(parsed) || parsed.length !== source.length) {
    return source;
  }
  return source.map((original, index) => {
    const candidate = parsed[index];
    return typeof candidate === "string" ? candidate : original;
  });
}

// Extracts a JSON array from a model response that may include prose or code
// fences around it.
function parseJsonArray(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function chunkStrings(values: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars = 0;

  for (const value of values) {
    const wouldOverflow =
      current.length >= TRANSLATE_CHUNK_MAX_ITEMS ||
      (current.length > 0 && currentChars + value.length > TRANSLATE_CHUNK_MAX_CHARS);
    if (wouldOverflow) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(value);
    currentChars += value.length;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

async function translateChunk({
  chunk,
  sourceLabel,
  targetLabel,
  AI,
}: {
  chunk: string[];
  sourceLabel: string;
  targetLabel: string;
  AI: AiBinding;
}): Promise<string[]> {
  const prompt = `You are a professional translator. Translate each string in the following JSON array from ${sourceLabel} to ${targetLabel}.

Rules:
- Return ONLY a JSON array of strings, with the exact same length and order as the input.
- Output item N must be the translation of input item N.
- Preserve URLs, markdown, HTML tags, code, numbers, and placeholders exactly.
- Preserve the leading and trailing whitespace of each string.
- Do not add, remove, split, merge, or reorder array items.
- Do not include any commentary — output only the JSON array.

Input:
${JSON.stringify(chunk)}`;

  const response = await runAiText({ AI, prompt, maxTokens: TRANSLATE_MAX_TOKENS });

  if (typeof response !== "string") {
    return chunk;
  }

  return reconcileTranslation(chunk, parseJsonArray(response));
}

// Translates a flat list of strings via Cloudflare AI, chunked to keep each
// request bounded. Always returns the same number of strings; on any failure it
// returns the source strings for that chunk.
async function translateStringsViaAi({
  values,
  sourceLocale,
  targetLocale,
  AI,
}: {
  values: string[];
  sourceLocale: Locale;
  targetLocale: Locale;
  AI: AiBinding;
}): Promise<{ values: string[]; ok: boolean }> {
  const sourceLabel = LOCALE_LABELS[sourceLocale] ?? sourceLocale;
  const targetLabel = LOCALE_LABELS[targetLocale] ?? targetLocale;

  const out: string[] = [];
  let ok = true;
  const chunks = chunkStrings(values);
  // Chunks are independent AI round-trips, so translate them concurrently in small
  // batches — faster than strictly sequential, but bounded so a large document
  // doesn't burst past Workers-AI rate limits. Batches (and results within a batch)
  // stay in order so the reassembled output lines up with the source values.
  for (let i = 0; i < chunks.length; i += TRANSLATE_CHUNK_CONCURRENCY) {
    const batch = chunks.slice(i, i + TRANSLATE_CHUNK_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (chunk) => {
        try {
          return { values: await translateChunk({ chunk, sourceLabel, targetLabel, AI }), ok: true };
        } catch (error) {
          // A thrown chunk (model 504/timeout/access error) is the common silent-copy
          // cause — record it so the caller can report "copied, not translated".
          console.error("Error translating content chunk:", error);
          return { values: chunk, ok: false };
        }
      })
    );
    for (const batchResult of batchResults) {
      out.push(...batchResult.values);
      if (!batchResult.ok) {
        ok = false;
      }
    }
  }
  return { values: out, ok };
}

// Deep-clones the content, translates its leaf strings with the injected
// translate function, and writes them back. Pure with respect to AI — used
// directly by unit tests.
export async function translateContent({
  content,
  translate,
}: {
  content: JSONContent;
  translate: TranslateStringsFn;
}): Promise<JSONContent> {
  const clone = structuredClone(content);
  const { values, setters } = collectTranslatableStrings(clone);
  if (values.length === 0) {
    return clone;
  }
  const translated = await translate(values);
  const safe = reconcileTranslation(values, translated);
  safe.forEach((value, index) => setters[index](value));
  return clone;
}

// A translatable field keyed by name (e.g. "title", "seoDescription"). Named so
// the batched translation can be mapped back to the right field regardless of
// which fields were blank and dropped from the batch.
interface NamedTranslationField<Name extends string> {
  name: Name;
  value: string | null | undefined;
}

interface TranslateNamedFieldsOptions {
  sourceLocale: Locale;
  targetLocale: Locale;
  AI: AiBinding;
  appendValues?: string[];
}

interface TranslatedNamedFields<Name extends string> {
  fields: Partial<Record<Name, string>>;
  appendedValues: string[];
  ok: boolean;
}

function hasTranslatableValue<Name extends string>(
  field: NamedTranslationField<Name>
): field is { name: Name; value: string } {
  return typeof field.value === "string" && field.value.trim().length > 0;
}

// Batches a set of named fields plus optional unnamed `appendValues` (the entry
// body strings) into a single AI round-trip, then splits the flat result back
// apart. Blank fields are dropped from the batch, so `fields` only contains keys
// that actually had text — callers fall back to the source for anything absent.
// `translateStringsViaAi` guarantees a same-length, same-order result, which is
// what lets the index math below line the translations back up with their fields.
async function translateNamedFields<Name extends string>(
  fields: Array<NamedTranslationField<Name>>,
  { sourceLocale, targetLocale, AI, appendValues = [] }: TranslateNamedFieldsOptions
): Promise<TranslatedNamedFields<Name>> {
  const translatableFields = fields.filter(hasTranslatableValue);
  const batch = [...translatableFields.map(({ value }) => value), ...appendValues];

  // Nothing to translate — signal `ok: false` so callers keep the originals.
  if (batch.length === 0) {
    return { fields: {}, appendedValues: [], ok: false };
  }

  const { values: translated, ok } = await translateStringsViaAi({
    values: batch,
    sourceLocale,
    targetLocale,
    AI,
  });

  const translatedFields: Partial<Record<Name, string>> = {};
  translatableFields.forEach(({ name }, index) => {
    translatedFields[name] = translated[index];
  });

  // Named fields occupy the front of the batch; everything after them is the
  // translated `appendValues`, handed back separately for the caller to reinject.
  return {
    fields: translatedFields,
    appendedValues: translated.slice(translatableFields.length),
    ok,
  };
}

// Shared guard flow for every translate helper: short-circuits to `fallback`
// when there is nothing to do (same locale, or caller-supplied `shouldTranslate`
// is false) or the Cloudflare AI binding is unavailable, and turns any thrown
// error into the same fallback. This is what makes "translation is best-effort,
// never fatal" a single contract instead of four hand-rolled try/catch blocks.
async function withAiTranslation<Result>({
  sourceLocale,
  targetLocale,
  fallback,
  shouldTranslate = true,
  logMessage,
  translate,
}: {
  sourceLocale: Locale;
  targetLocale: Locale;
  fallback: Result;
  shouldTranslate?: boolean;
  logMessage: string;
  translate: (AI: AiBinding) => Promise<Result>;
}): Promise<Result> {
  if (sourceLocale === targetLocale || !shouldTranslate) {
    return fallback;
  }

  try {
    const { env } = await getCloudflareContext();
    const AI = env.AI;
    if (!AI) {
      return fallback;
    }
    return await translate(AI);
  } catch (error) {
    console.error(logMessage, error);
    return fallback;
  }
}

interface TranslateEntryFieldsParams {
  title: string;
  seoDescription: string | null;
  content: JSONContent;
  sourceLocale: Locale;
  targetLocale: Locale;
  // Restrict translation to a subset of fields (e.g. re-translating only the ones
  // that drifted, so a title edit doesn't re-process an unchanged body). Omit to
  // translate all three. Fields not listed are returned as passed in, untouched.
  only?: readonly TranslatableEntryField[];
}

interface TranslatedEntryFields {
  title: string;
  seoDescription: string | null;
  content: JSONContent;
  // false when the result is a verbatim copy (AI unavailable, timed out, or the
  // locales matched) so the caller can tell the user it was not translated.
  translated: boolean;
}

// Translates an entry's title, SEO description, and body in a single batched AI
// call. Returns the originals unchanged (translated: false) when the AI binding is
// unavailable, the locales match, or anything throws — so the caller always gets a
// valid, structurally intact document (a verbatim copy in the worst case).
export async function translateEntryFields({
  title,
  seoDescription,
  content,
  sourceLocale,
  targetLocale,
  only,
}: TranslateEntryFieldsParams): Promise<TranslatedEntryFields> {
  const original: TranslatedEntryFields = { title, seoDescription, content, translated: false };

  const wantsTitle = !only || only.includes("title");
  const wantsSeo = !only || only.includes("seoDescription");
  const wantsContent = !only || only.includes("content");

  return withAiTranslation({
    sourceLocale,
    targetLocale,
    fallback: original,
    logMessage: "Error translating CMS entry:",
    translate: async (AI) => {
      // Only clone/collect the body when it's in scope — skipping it entirely is
      // what makes a title-only re-translation cheap (no body round-trip).
      const clone = wantsContent ? structuredClone(content) : content;
      const { values, setters } = wantsContent
        ? collectTranslatableStrings(clone)
        : { values: [] as string[], setters: [] as Array<(value: string) => void> };

      // One batch: [named fields..., ...bodyStrings] → one AI round-trip for a
      // typical short post, without every caller hand-rebuilding field order.
      const namedFields = [
        ...(wantsTitle ? [{ name: "title" as const, value: title }] : []),
        ...(wantsSeo ? [{ name: "seoDescription" as const, value: seoDescription }] : []),
      ];

      const translated = await translateNamedFields(namedFields, {
        appendValues: values,
        sourceLocale,
        targetLocale,
        AI,
      });

      // Bail to the untouched original only when the AI failed AND there is no
      // body text to write back. If body strings came through we still reinject
      // them below (translated: false will flag it as a partial/verbatim result).
      if (translated.ok === false && translated.appendedValues.length === 0) {
        return original;
      }

      translated.appendedValues.forEach((value, index) => {
        setters[index](value);
      });

      const translatedSeo = translated.fields.seoDescription;

      return {
        title: wantsTitle ? translated.fields.title ?? title : title,
        seoDescription: wantsSeo
          ? typeof translatedSeo === "string"
            ? truncateSeoDescription(translatedSeo)
            : seoDescription
          : seoDescription,
        content: wantsContent ? clone : content,
        translated: translated.ok,
      };
    },
  });
}

// Translates a single short string (e.g. a navigation label). Same safety contract
// as the entry/tag helpers: returns the source unchanged (translated: false) when
// the AI binding is unavailable, the locales match, the string is blank, or
// anything throws.
export async function translateText({
  text,
  sourceLocale,
  targetLocale,
}: {
  text: string;
  sourceLocale: Locale;
  targetLocale: Locale;
}): Promise<{ text: string; translated: boolean }> {
  const original = { text, translated: false };

  return withAiTranslation({
    sourceLocale,
    targetLocale,
    fallback: original,
    shouldTranslate: text.trim().length > 0,
    logMessage: "Error translating text:",
    translate: async (AI) => {
      const translated = await translateNamedFields([{ name: "text", value: text }], {
        sourceLocale,
        targetLocale,
        AI,
      });

      return {
        text: translated.fields.text ?? text,
        translated: translated.ok,
      };
    },
  });
}

interface TranslateTagFieldsParams {
  name: string;
  description: string | null;
  sourceLocale: Locale;
  targetLocale: Locale;
}

interface TranslatedTagFields {
  name: string;
  description: string | null;
  // false when the result is a verbatim copy (AI unavailable, timed out, or the
  // locales matched) so the caller can tell the user it was not translated.
  translated: boolean;
}

// Translates a tag's name and description in a single batched AI call. Mirrors
// translateEntryFields' safety contract: returns the originals unchanged
// (translated: false) when the AI binding is unavailable, the locales match, or
// anything throws — the caller always gets valid strings.
export async function translateTagFields({
  name,
  description,
  sourceLocale,
  targetLocale,
}: TranslateTagFieldsParams): Promise<TranslatedTagFields> {
  const original: TranslatedTagFields = { name, description, translated: false };

  return withAiTranslation({
    sourceLocale,
    targetLocale,
    fallback: original,
    logMessage: "Error translating CMS tag:",
    translate: async (AI) => {
      const translated = await translateNamedFields(
        [
          { name: "name", value: name },
          { name: "description", value: description },
        ],
        {
          sourceLocale,
          targetLocale,
          AI,
        }
      );

      if (translated.ok === false) {
        return original;
      }

      return {
        name: translated.fields.name ?? name,
        description: translated.fields.description ?? description,
        translated: translated.ok,
      };
    },
  });
}
