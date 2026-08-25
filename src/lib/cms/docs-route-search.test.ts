// Every expectation derives from the route table, the locale catalogs, or the OpenAPI fixture, so a
// fork that rewrites the docs copy or replaces the routes keeps these passing.

import { describe, expect, test, vi } from "vitest";

import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/config";
import { loadMessages } from "@/i18n/load-messages";
import type { MessageTree } from "@/i18n/message-catalogs";
import { FIXTURE_API_OPERATION } from "../../../tests/fixtures/api-openapi-document";

vi.mock("server-only", () => ({}));

const { searchDocsRoutes } = await import("@/lib/cms/docs-route-search");

const NON_DEFAULT_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) as Locale;
const SEARCH_LIMIT = 8;
const ROUTE_ENTRY_PREFIX = "docs-route:";
/** `Client.Docs.<namespace>.<meta key>`, so both names come from the route table, not from copy. */
const ROUTE_NAMESPACES = new Map(
  INDEXED_DOCS_ROUTES.map((route) => [route.metaNamespace.split(".").at(-2) as string, route])
);
const META_KEY = INDEXED_DOCS_ROUTES[0].metaNamespace.split(".").at(-1) as string;

async function docsNamespace({ locale, namespace }: { locale: Locale; namespace: string }): Promise<MessageTree> {
  const client = (await loadMessages(locale)).Client as MessageTree;
  const docs = client.Docs as MessageTree;

  return docs[namespace] as MessageTree;
}

function firstWordOf(text: string): string {
  return text.toLowerCase().match(/[a-z0-9]+/g)?.[0] ?? "";
}

function search({ query, locale = DEFAULT_LOCALE }: { query: string; locale?: Locale }) {
  return searchDocsRoutes({ query, limit: SEARCH_LIMIT, locale });
}

describe("docs route search", () => {
  test("finds every indexed docs route by its own title", async () => {
    for (const route of INDEXED_DOCS_ROUTES) {
      const results = await search({
        query: route.pathname.split("/").filter(Boolean).at(-1) ?? "",
      });

      expect(
        results.some((result) => result.resolvedPath === route.pathname),
        `no result for ${route.pathname}`
      ).toBe(true);
    }
  });

  test("a title hit is a strong match and carries the page path", async () => {
    const mcpRoute = INDEXED_DOCS_ROUTES.find((route) => route.id === "mcpGuide");
    const title = (await docsNamespace({ locale: DEFAULT_LOCALE, namespace: "Mcp" })).title as string;

    const [result] = await search({ query: title });

    expect(result.resolvedPath).toBe(mcpRoute?.pathname);
    expect(result.title).toBe(title);
    expect(result.isStrongMatch).toBe(true);
  });

  test("matches prose inside a section body, snippeting around the hit", async () => {
    const auth = await docsNamespace({ locale: DEFAULT_LOCALE, namespace: "Auth" });
    const bodyWords = (auth.keysBody as string).split(" ");
    const query = bodyWords.slice(4, 7).join(" ");

    const [result] = await search({ query });

    expect(result.snippet.toLowerCase()).toContain(firstWordOf(query));
    expect(result.snippet.length).toBeLessThan((auth.keysBody as string).length);
  });

  // Nested keys are the content: `ApiErrors.codes` is keyed by the error codes a caller reads off a
  // failed response, and those keys are the same in every locale.
  test("indexes the keys of a nested subtree, at heading weight", async () => {
    for (const [namespace, route] of ROUTE_NAMESPACES) {
      const tree = await docsNamespace({ locale: DEFAULT_LOCALE, namespace });

      for (const [key, value] of Object.entries(tree)) {
        if (key === META_KEY || typeof value === "string" || Array.isArray(value)) {
          continue;
        }

        const [nestedKey] = Object.keys(value);
        const results = await search({ query: nestedKey });

        expect(
          results.some(
            (result) =>
              result.entryId === `${ROUTE_ENTRY_PREFIX}${route.id}` && result.isStrongMatch
          ),
          `no strong result for ${namespace}.${key}.${nestedKey}`
        ).toBe(true);
      }
    }
  });

  // `meta` repeats the page title for the document head, so its key names sit in every namespace of
  // every locale. Index them and one query returns the whole docs section as a strong match.
  test("a document-head key name is not a search term", async () => {
    const [namespace] = ROUTE_NAMESPACES.keys();
    const tree = await docsNamespace({ locale: DEFAULT_LOCALE, namespace });

    for (const metaKey of Object.keys(tree[META_KEY] as MessageTree)) {
      const results = await search({ query: metaKey });

      expect(
        results.filter(
          (result) => result.entryId.startsWith(ROUTE_ENTRY_PREFIX) && result.isStrongMatch
        ),
        `"${metaKey}" strong-matched docs routes`
      ).toEqual([]);
    }
  });

  // A control label is chrome, not prose: its verb belongs to a button, and a reader who searches
  // for that verb wants a page about it, not every page that renders the button.
  test("a control label keeps its own words out of the index", async () => {
    for (const [namespace, route] of ROUTE_NAMESPACES) {
      const tree = await docsNamespace({ locale: DEFAULT_LOCALE, namespace });
      const labelKeys = Object.keys(tree).filter((key) => /^copy[A-Z]/.test(key));

      for (const labelKey of labelKeys) {
        const results = await search({ query: firstWordOf(tree[labelKey] as string) });

        expect(
          results.some((result) => result.entryId === `${ROUTE_ENTRY_PREFIX}${route.id}`),
          `${namespace}.${labelKey} put its label in the index`
        ).toBe(false);
      }
    }
  });

  test("every query token has to match, like the FTS5 query", async () => {
    const title = (await docsNamespace({ locale: DEFAULT_LOCALE, namespace: "Mcp" })).title as string;

    await expect(search({ query: `${title} zzzznotinanycatalog` })).resolves.toEqual([]);
  });

  test("returns nothing for a query with no usable tokens", async () => {
    await expect(search({ query: "!!!" })).resolves.toEqual([]);
  });

  test("respects the limit", async () => {
    const results = await searchDocsRoutes({ query: "api", limit: 1, locale: DEFAULT_LOCALE });

    expect(results).toHaveLength(1);
  });

  test("searches the active locale's copy", async () => {
    const translatedTitle = (await docsNamespace({ locale: NON_DEFAULT_LOCALE, namespace: "Mcp" }))
      .title as string;

    const [result] = await search({ query: translatedTitle, locale: NON_DEFAULT_LOCALE });

    expect(result.title).toBe(translatedTitle);
  });

  test("indexes page text that does not use a title or body key", async () => {
    const apiReference = await docsNamespace({
      locale: NON_DEFAULT_LOCALE,
      namespace: "ApiReference",
    });
    const query = apiReference.agentGuidance as string;

    const results = await search({ query, locale: NON_DEFAULT_LOCALE });

    expect(results.some((result) => result.entryId === "docs-route:apiReference")).toBe(true);
  });

  // The path is the one part of a docs route a translation does not move, so it is what someone
  // types who knows the URL but not the language the page is written in.
  test.each(INDEXED_DOCS_ROUTES.filter((route) => route.pathname.split("/").length > 2))(
    "finds $pathname by its own path segment in a translated locale",
    async ({ pathname }) => {
      const slug = pathname.split("/").filter(Boolean).at(-1) as string;

      const results = await search({ query: slug, locale: NON_DEFAULT_LOCALE });

      expect(results.some((result) => result.resolvedPath === pathname)).toBe(true);
    },
  );

  test("finds an API operation and anchors it inside the reference page", async () => {
    const [result] = await search({ query: FIXTURE_API_OPERATION.summary });

    expect(result.entryId).toBe(`api-operation:${FIXTURE_API_OPERATION.operationId}`);
    expect(result.title).toBe(FIXTURE_API_OPERATION.summary);
    expect(result.resolvedPath).toContain(`#operation-${FIXTURE_API_OPERATION.operationId}`);
  });

  test("finds an operation by its path, method, and scope", async () => {
    for (const query of [
      FIXTURE_API_OPERATION.path,
      FIXTURE_API_OPERATION.method,
      FIXTURE_API_OPERATION.scope,
    ]) {
      const results = await search({ query });

      expect(
        results.some(
          (result) => result.entryId === `api-operation:${FIXTURE_API_OPERATION.operationId}`
        ),
        `no operation result for "${query}"`
      ).toBe(true);
    }
  });
});
