import "server-only";

import { API_DOCS_PATH } from "@/constants";
import { INDEXED_DOCS_ROUTES, type DocsRouteId } from "@/constants/docs-routes";
import type { Locale } from "@/i18n/config";
import { loadMessages } from "@/i18n/load-messages";
import type { MessageTree } from "@/i18n/message-catalogs";
import { operationAnchorId, scopeOfOperation, walkOperations } from "@/lib/api/openapi-walk";
import { lazyValue, lazyValueByKey } from "@/utils/lazy-value";
import { hasPrefixMatch, tokenizeSearchQuery, tokenizeSearchText } from "./search-tokens";

// ---------------------------------------------------------------------------
// The half of docs search that is not CMS content: the docs pages that are app routes, and the API
// operations rendered inside the reference page. Neither can ever reach the FTS5 index, which joins
// `cms_entry`, so they are matched in memory here and merged by `searchDocs`.
//
// Cheap enough to run per request: the index is a few dozen documents, built once per isolate.
// ---------------------------------------------------------------------------

/** Mirrors the bm25 column weights of the CMS query, so both halves rank on the same scale. */
const TITLE_MATCH_WEIGHT = 8;
const HEADING_MATCH_WEIGHT = 3;
const BODY_MATCH_WEIGHT = 1;
/** Words kept either side of the first hit; the FTS5 `snippet()` window is 18 tokens wide. */
const SNIPPET_WORD_RADIUS = 9;
const SNIPPET_ELLIPSIS = " ... ";
/** `meta` restates the page title for the document head, so indexing it only doubles every hit. */
const SKIPPED_NAMESPACE_KEYS = new Set(["meta"]);

/**
 * Catalog namespace under `Client.Docs` holding each route's prose. Total over the route ids, so a
 * new docs route has to decide whether it is searchable rather than silently missing from results.
 * `null` = nothing to index, for the machine endpoints that render no prose of their own.
 */
const DOCS_ROUTE_MESSAGE_NAMESPACES: Record<DocsRouteId, string | null> = {
  llmsTxt: null,
  openApiDocument: null,
  apiReference: "ApiReference",
  apiErrors: "ApiErrors",
  authGuide: "Auth",
  mcpGuide: "Mcp",
};

export interface DocsRouteSearchResult {
  entryId: string;
  title: string;
  slug: string;
  seoDescription: string | null;
  resolvedPath: string;
  snippet: string;
  /** A title or heading hit; body-only hits rank below the CMS results instead of above them. */
  isStrongMatch: boolean;
}

interface DocsRouteSearchDocument {
  entryId: string;
  title: string;
  slug: string;
  seoDescription: string | null;
  resolvedPath: string;
  titleTokens: string[];
  headingTokens: string[];
  bodyTokens: string[];
  bodyText: string;
}

interface NamespaceText {
  title: string;
  description: string | null;
  headings: string[];
  body: string[];
}

interface DocumentScore {
  score: number;
  isStrongMatch: boolean;
}

// Built once per isolate — the route half per locale, the operation half shared; see
// `lazyValueByKey`/`lazyValue` for the contract.
const loadRouteDocuments = lazyValueByKey(buildRouteDocuments);
const loadOperationDocuments = lazyValue(buildOperationDocuments);

function* walkStringLeaves(tree: MessageTree): Generator<[string, string]> {
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") {
      yield [key, value];
      continue;
    }

    if (!Array.isArray(value)) {
      yield* walkStringLeaves(value);
    }
  }
}

function isMessageSubtree(value: string | string[] | MessageTree): value is MessageTree {
  return typeof value !== "string" && !Array.isArray(value);
}

// Index prose, not chrome: the page title and description plus the `*Title`/`*Body` pairs
// `DocsProsePage` renders. Button and column labels stay out, or "copy" would match every page.
function classifyLeafKey(key: string): keyof NamespaceText | null {
  if (key === "title" || key === "description") {
    return key;
  }

  if (key.endsWith("Title")) {
    return "headings";
  }

  return key.endsWith("Body") ? "body" : null;
}

function applyLeaf({
  key,
  value,
  collected,
}: {
  key: string;
  value: string;
  collected: NamespaceText;
}): void {
  const field = classifyLeafKey(key);

  if (field === "title" || field === "description") {
    collected[field] = value;
  } else if (field) {
    collected[field].push(value);
  }
}

// A nested key is itself a search term: `ApiErrors.codes` is keyed by the error codes.
function applySubtree({ tree, collected }: { tree: MessageTree; collected: NamespaceText }): void {
  for (const [nestedKey, nestedValue] of walkStringLeaves(tree)) {
    collected.headings.push(nestedKey);
    collected.body.push(nestedValue);
  }
}

function collectNamespaceText(tree: MessageTree): NamespaceText {
  const collected: NamespaceText = { title: "", description: null, headings: [], body: [] };

  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") {
      applyLeaf({ key, value, collected });
    } else if (isMessageSubtree(value) && !SKIPPED_NAMESPACE_KEYS.has(key)) {
      applySubtree({ tree: value, collected });
    }
  }

  return collected;
}

// Catalog strings are indexed raw, so a snippet would otherwise show a reader the ICU placeholders
// and rich-text tags that `next-intl` fills in at render time.
function normalizeIndexedText(text: string): string {
  return text
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueTokens(text: string): string[] {
  return [...new Set(tokenizeSearchText(text))];
}

function toDocument({
  entryId,
  title,
  slug,
  description,
  resolvedPath,
  headings,
  body,
}: {
  entryId: string;
  title: string;
  slug: string;
  description: string | null;
  resolvedPath: string;
  headings: string[];
  body: string[];
}): DocsRouteSearchDocument {
  const normalizedTitle = normalizeIndexedText(title);
  const headingText = normalizeIndexedText(headings.join(" "));
  const bodyText = normalizeIndexedText([description ?? "", ...body].join(" "));

  return {
    entryId,
    title: normalizedTitle,
    slug,
    seoDescription: description === null ? null : normalizeIndexedText(description),
    resolvedPath,
    // Deduped: scoring prefix-scans these, and a page's body repeats its vocabulary heavily.
    titleTokens: uniqueTokens(normalizedTitle),
    headingTokens: uniqueTokens(headingText),
    bodyTokens: uniqueTokens(bodyText),
    bodyText,
  };
}

function lastPathSegment(pathname: string): string {
  return pathname.split("/").filter(Boolean).at(-1) ?? pathname;
}

async function buildRouteDocuments(locale: Locale): Promise<DocsRouteSearchDocument[]> {
  const docsMessages = (await loadMessages(locale)).Client as MessageTree | undefined;
  const namespaces = (docsMessages?.Docs ?? {}) as MessageTree;

  return INDEXED_DOCS_ROUTES.flatMap((route) => {
    const namespaceKey = DOCS_ROUTE_MESSAGE_NAMESPACES[route.id];
    const namespace = namespaceKey ? namespaces[namespaceKey] : undefined;

    if (!namespace || typeof namespace !== "object" || Array.isArray(namespace)) {
      return [];
    }

    const { title, description, headings, body } = collectNamespaceText(namespace);

    if (!title) {
      return [];
    }

    return [
      toDocument({
        entryId: `docs-route:${route.id}`,
        title,
        slug: lastPathSegment(route.pathname),
        description,
        resolvedPath: route.pathname,
        headings,
        body,
      }),
    ];
  });
}

// Operations are sections of the reference page, addressed by the same anchor the page renders.
// Their text is the untranslated OpenAPI document, which is what the page shows in every locale.
//
// The document is imported lazily: `cms-search` is reached from the site nav, so a static import
// would put 60+ KiB of it in the graph of every marketing, auth, and legal page.
async function buildOperationDocuments(): Promise<DocsRouteSearchDocument[]> {
  const { apiDocument } = await import("@/api/generated-document");

  return [...walkOperations(apiDocument())].flatMap(({ path, method, operation }) => {
    const { operationId } = operation;

    if (!operationId) {
      return [];
    }

    const summary = operation.summary ?? operationId;
    const scope = scopeOfOperation(operation);

    return [
      toDocument({
        entryId: `api-operation:${operationId}`,
        title: summary,
        slug: operationId,
        description: operation.description || summary,
        resolvedPath: `${API_DOCS_PATH}#${operationAnchorId(operationId)}`,
        headings: [
          method.toUpperCase(),
          path,
          operationId,
          ...(operation.tags ?? []),
          ...(scope ? [scope] : []),
        ],
        body: [],
      }),
    ];
  });
}

async function getSearchDocuments(locale: Locale): Promise<DocsRouteSearchDocument[]> {
  const [routes, operations] = await Promise.all([
    loadRouteDocuments(locale),
    loadOperationDocuments(),
  ]);

  return [...routes, ...operations];
}

function scoreDocument({
  document,
  queryTokens,
}: {
  document: DocsRouteSearchDocument;
  queryTokens: string[];
}): DocumentScore | null {
  let score = 0;
  let isStrongMatch = false;

  // Every token must match somewhere, the same AND semantics as the FTS5 query.
  for (const queryToken of queryTokens) {
    const weight = hasPrefixMatch({ tokens: document.titleTokens, queryToken })
      ? TITLE_MATCH_WEIGHT
      : hasPrefixMatch({ tokens: document.headingTokens, queryToken })
        ? HEADING_MATCH_WEIGHT
        : hasPrefixMatch({ tokens: document.bodyTokens, queryToken })
          ? BODY_MATCH_WEIGHT
          : 0;

    if (weight === 0) {
      return null;
    }

    score += weight;
    isStrongMatch ||= weight >= HEADING_MATCH_WEIGHT;
  }

  return { score, isStrongMatch };
}

/** Word positions where a query token matches, paired with which token matched there. */
function findMatchPositions({
  words,
  queryTokens,
}: {
  words: string[];
  queryTokens: string[];
}): Array<{ index: number; tokenIndex: number }> {
  const positions: Array<{ index: number; tokenIndex: number }> = [];

  words.forEach((word, index) => {
    const wordTokens = tokenizeSearchText(word);

    queryTokens.forEach((queryToken, tokenIndex) => {
      if (hasPrefixMatch({ tokens: wordTokens, queryToken })) {
        positions.push({ index, tokenIndex });
      }
    });
  });

  return positions;
}

// Centre on the window covering the most distinct query tokens, not on the first hit: a common word
// in the query would otherwise anchor every snippet to the opening sentence.
function buildSnippet({
  bodyText,
  queryTokens,
}: {
  bodyText: string;
  queryTokens: string[];
}): string | null {
  const words = bodyText.split(" ").filter(Boolean);
  const positions = findMatchPositions({ words, queryTokens });
  const [firstPosition] = positions;

  if (!firstPosition) {
    return null;
  }

  let hitIndex = firstPosition.index;
  let bestCoverage = 0;

  for (const candidate of positions) {
    const covered = new Set(
      positions
        .filter((position) => Math.abs(position.index - candidate.index) <= SNIPPET_WORD_RADIUS)
        .map((position) => position.tokenIndex)
    );

    if (covered.size > bestCoverage) {
      bestCoverage = covered.size;
      hitIndex = candidate.index;
    }
  }

  const start = Math.max(0, hitIndex - SNIPPET_WORD_RADIUS);
  const end = Math.min(words.length, hitIndex + SNIPPET_WORD_RADIUS + 1);
  const snippet = words.slice(start, end).join(" ");

  return [
    start > 0 ? SNIPPET_ELLIPSIS.trimStart() : "",
    snippet,
    end < words.length ? SNIPPET_ELLIPSIS.trimEnd() : "",
  ].join("");
}

export async function searchDocsRoutes({
  query,
  limit,
  locale,
}: {
  query: string;
  limit: number;
  locale: Locale;
}): Promise<DocsRouteSearchResult[]> {
  const queryTokens = tokenizeSearchQuery(query);

  // Ahead of `getSearchDocuments`, so a junk query never pulls in the OpenAPI document.
  if (queryTokens.length === 0) {
    return [];
  }

  const documents = await getSearchDocuments(locale);

  return documents
    .flatMap((document) => {
      const scored = scoreDocument({ document, queryTokens });

      return scored ? [{ document, ...scored }] : [];
    })
    .sort((first, second) => second.score - first.score)
    .slice(0, limit)
    .map(({ document, isStrongMatch }) => ({
      entryId: document.entryId,
      title: document.title,
      slug: document.slug,
      seoDescription: document.seoDescription,
      resolvedPath: document.resolvedPath,
      snippet:
        buildSnippet({ bodyText: document.bodyText, queryTokens })
        ?? document.seoDescription
        ?? document.title,
      isStrongMatch,
    }));
}
