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

  test("indexes error codes, which are keys rather than values in the catalog", async () => {
    const codes = (await docsNamespace({ locale: DEFAULT_LOCALE, namespace: "ApiErrors" }))
      .codes as MessageTree;
    const [code] = Object.keys(codes);

    const results = await search({ query: code });

    expect(results.some((result) => result.entryId === "docs-route:apiErrors")).toBe(true);
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
