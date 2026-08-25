import "server-only";

import { API_DOCS_PATH } from "@/constants";
import { INDEXED_DOCS_ROUTES, type DocsRouteId } from "@/constants/docs-routes";
import type { Locale } from "@/i18n/config";
import { loadMessages } from "@/i18n/load-messages";
import type { MessageTree } from "@/i18n/message-catalogs";
import { operationAnchorId, scopeOfOperation, walkOperations } from "@/lib/api/openapi-walk";
import { lazyValue, lazyValueByKey } from "@/utils/lazy-value";
import { hasPrefixMatch, tokenizeIndexQuery, tokenizeIndexText } from "./search-tokens";

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
/**
 * Chrome keys, at any depth: they name a control or the document head, never prose. Without this,
 * `meta.title` makes every route a strong match for `title`, and `copyExample` one for `copy`.
 * Name a new chrome key to match this pattern, or its text becomes a search term.
 */
const CHROME_KEY_PATTERN = /^meta$|^(copy|column)[A-Z]|(Label|Link|Button|Placeholder)$/;
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

// The prose convention: these keys say where their own value belongs. Every other key carries text
// of its own instead, so the walk indexes the key as well as the value.
function proseSlotOfKey(key: string): keyof NamespaceText | null {
  if (key === "title" || key === "description") {
    return key;
  }

  if (key.endsWith("Title")) {
    return "headings";
  }

  return key.endsWith("Body") ? "body" : null;
}

// One rule at every depth, so a key means the same thing wherever the catalog nests it.
function walkNamespace({ tree, collected }: { tree: MessageTree; collected: NamespaceText }): void {
  for (const [key, value] of Object.entries(tree)) {
    // A string array is a `t.raw` list, which no docs route renders as prose.
    if (CHROME_KEY_PATTERN.test(key) || Array.isArray(value)) {
      continue;
    }

    const slot = proseSlotOfKey(key);

    // A key outside the convention is a search term itself: `ApiErrors.codes` is keyed by the
    // error codes, and a reader searches for the code, not for the sentence that explains it.
    if (slot === null) {
      collected.headings.push(key);
    }

    if (typeof value !== "string") {
      walkNamespace({ tree: value, collected });
      continue;
    }

    if (slot === "title" || slot === "description") {
      collected[slot] = value;
      continue;
    }

    collected[slot ?? "body"].push(value);
  }
}

function collectNamespaceText(tree: MessageTree): NamespaceText {
  const collected: NamespaceText = { title: "", description: null, headings: [], body: [] };

  walkNamespace({ tree, collected });

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
  return [...new Set(tokenizeIndexText(text))];
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
    // The slug joins the headings so a page stays findable by the words of its own URL. Those are
    // the one part of a docs route that does not change when the catalog is translated, and they
    // are what someone types who knows the path but not the language the copy is written in.
    headingTokens: uniqueTokens(`${slug} ${headingText}`),
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
    const wordTokens = tokenizeIndexText(word);

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
  const queryTokens = tokenizeIndexQuery(query);

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
