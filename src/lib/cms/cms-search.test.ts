import { afterEach, describe, expect, test, vi } from "vitest";

import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/config";
import { loadMessages } from "@/i18n/load-messages";
import type { MessageTree } from "@/i18n/message-catalogs";

const {
  getDBMock,
  workerEnvMock,
  setCacheScopeMock,
} = vi.hoisted(() => ({
  getDBMock: vi.fn(),
  workerEnvMock: {} as Record<string, unknown>,
  setCacheScopeMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("cloudflare:workers", () => ({
  env: workerEnvMock,
}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

vi.mock("@/utils/cache", () => ({
  CACHE_TAGS: {
    cmsSearchCollection: (collectionSlug: string) => `cms-search-${collectionSlug}`,
  },
  setCacheScope: setCacheScopeMock,
}));

const { searchDocs } = await import("@/lib/cms/cms-search");
const NON_DEFAULT_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) as Locale;

const CMS_SEARCH_ROW = {
  entryId: "cms_ent_docs002",
  title: "Authentication Setup",
  slug: "authentication-setup",
  seoDescription: "Configure Lucia auth.",
  resolvedPath: "/docs/getting-started/authentication",
  snippet: "Authentication Setup",
};

/** The MCP page's own title, so the query stays right whatever a fork renames it to. */
async function mcpTitle(): Promise<string> {
  const client = (await loadMessages(DEFAULT_LOCALE)).Client as MessageTree;
  const docs = client.Docs as MessageTree;

  return (docs.Mcp as MessageTree).title as string;
}

describe("CMS search", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("returns no results for empty search terms without opening a cache scope", async () => {
    await expect(searchDocs({ query: "!!!", limit: 8, locale: DEFAULT_LOCALE })).resolves.toEqual([]);

    expect(setCacheScopeMock).not.toHaveBeenCalled();
  });

  function mockSearchDatabase(): {
    d1: { batch: ReturnType<typeof vi.fn>; prepare: ReturnType<typeof vi.fn> };
    statements: Array<{ sql: string; binds: unknown[] }>;
  } {
    const statements: Array<{ sql: string; binds: unknown[] }> = [];
    const d1 = {
      batch: vi.fn().mockResolvedValue([]),
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...binds: unknown[]) => {
          statements.push({ sql, binds });

          return {
            first: vi.fn().mockResolvedValue({ count: 0 }),
            all: vi.fn().mockResolvedValue({
              results: [CMS_SEARCH_ROW],
            }),
            run: vi.fn().mockResolvedValue({ success: true }),
          };
        }),
        run: vi.fn().mockResolvedValue({ success: true }),
      })),
    };

    return { d1, statements };
  }

  test("opens a cache scope and rebuilds an empty docs search index", async () => {
    const { d1, statements } = mockSearchDatabase();

    workerEnvMock.NEXT_TAG_CACHE_D1 = d1;
    getDBMock.mockReturnValue({
      query: {
        cmsEntryTable: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "cms_ent_docs002",
              collection: "docs",
              slug: "authentication-setup",
              title: "Authentication Setup",
              seoDescription: "Configure Lucia auth.",
              content: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Configure auth providers." }],
                  },
                ],
              },
            },
          ]),
        },
      },
    });
    await expect(searchDocs({
      query: "authentication",
      limit: 3,
      locale: NON_DEFAULT_LOCALE,
    })).resolves.toContainEqual(CMS_SEARCH_ROW);

    expect(setCacheScopeMock).toHaveBeenCalledWith({
      tags: ["cms-search-docs"],
      ttl: "6 hours",
    });
    expect(d1.batch).toHaveBeenCalledOnce();
    expect(statements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sql: "SELECT count(*) as count FROM cms_entry_search WHERE collection = ?",
          binds: ["docs"],
        }),
      ])
    );

    // The search query filters by the requested locale and resolves the path via
    // the default-locale anchor (bound first for the anchor join).
    const searchStatement = statements.find((statement) =>
      statement.sql.includes("cms_entry_search MATCH ?")
    );
    expect(searchStatement?.sql).toContain("AND entry.locale = ?");
    expect(searchStatement?.binds).toEqual([
      DEFAULT_LOCALE,
      "docs",
      "authentication*",
      "docs",
      NON_DEFAULT_LOCALE,
      "published",
      3,
    ]);
  });

  // Docs pages that are app routes never reach the FTS5 index; `searchDocs` merges them in, ranking
  // a title hit above the CMS rows and keeping the caller's limit.
  test("merges docs route hits ahead of CMS entry hits", async () => {
    const { d1 } = mockSearchDatabase();

    workerEnvMock.NEXT_TAG_CACHE_D1 = d1;
    getDBMock.mockReturnValue({
      query: { cmsEntryTable: { findMany: vi.fn().mockResolvedValue([]) } },
    });

    const mcpRoute = INDEXED_DOCS_ROUTES.find((route) => route.id === "mcpGuide");
    const results = await searchDocs({
      query: await mcpTitle(),
      limit: 3,
      locale: DEFAULT_LOCALE,
    });

    expect(results[0]?.resolvedPath).toBe(mcpRoute?.pathname);
    expect(results).toContainEqual(CMS_SEARCH_ROW);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
