/// <reference types="@cloudflare/vitest-plugin/types" />

// Docs search answers from two indexes: this FTS5 table and the in-memory docs-route index. They
// have to fold a query identically, or a result shows up in one half of the page and not the other.
// `search-tokens.ts` is the JS half; this replays the same words against real FTS5.

import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";

import {
  hasPrefixMatch,
  tokenizeIndexQuery,
  tokenizeIndexText,
  tokenizeSearchQuery,
} from "@/lib/cms/search-tokens";

const ROW_ID = "tokenizer-parity";

/** Text a fork might publish, and the way someone types it when their keyboard has no accents. */
const FOLDING_CASES: Array<{ language: string; text: string; query: string }> = [
  { language: "English", text: "API keys and OAuth", query: "oauth" },
  { language: "Spanish", text: "Documentación de la API", query: "documentacion" },
  { language: "French", text: "Créer un compte", query: "creer" },
  { language: "Romanian", text: "Înregistrare și securitate", query: "inregistrare" },
  { language: "Turkish", text: "Şifre değiştir", query: "sifre" },
  { language: "Polish", text: "Zarządzanie kluczami", query: "zarzadzanie" },
  { language: "Vietnamese", text: "Tài liệu hướng dẫn", query: "lieu" },
  { language: "Bulgarian", text: "Удостоверяване на самоличност", query: "удостоверяване" },
  { language: "Greek", text: "Τεκμηρίωση", query: "τεκμηρίωση" },
];

// `toLowerCase` turns `İ` into `i` plus a combining dot, and NFD text carries marks already. The
// query token keeps the mark; FTS5 tokenizes the `MATCH` string too, so it strips the mark there.
const COMBINING_MARK_CASES: Array<{ language: string; text: string; query: string }> = [
  { language: "Turkish", text: "İstanbul rehberi", query: "İstanbul" },
  { language: "Turkish", text: "İçerik yönetimi", query: "İçerik" },
  {
    language: "Spanish NFD",
    text: "Documentación de la API".normalize("NFD"),
    query: "documentación".normalize("NFD"),
  },
];

async function indexBody(body: string): Promise<void> {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM cms_entry_search WHERE entryId = ?").bind(ROW_ID),
    env.D1_DB
      .prepare(
        "INSERT INTO cms_entry_search(entryId, collection, slug, title, seoDescription, body) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(ROW_ID, "docs", "parity", "", "", body),
  ]);
}

/** The same `token*` clause `buildCmsSearchMatchQuery` sends. */
async function ftsMatches(query: string): Promise<boolean> {
  const tokens = tokenizeSearchQuery(query);
  const row = await env.D1_DB
    .prepare("SELECT count(*) as count FROM cms_entry_search WHERE entryId = ? AND cms_entry_search MATCH ?")
    .bind(ROW_ID, tokens.map((token) => `${token}*`).join(" AND "))
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0) > 0;
}

/** How the in-memory docs-route index scores the same query. */
function inMemoryMatches({ text, query }: { text: string; query: string }): boolean {
  const tokens = tokenizeIndexText(text);

  return tokenizeIndexQuery(query).every((queryToken) => hasPrefixMatch({ tokens, queryToken }));
}

beforeEach(async () => {
  await env.D1_DB.prepare("DELETE FROM cms_entry_search WHERE entryId = ?").bind(ROW_ID).run();
});

test.each(FOLDING_CASES)("$language: both halves match $query", async ({ text, query }) => {
  await indexBody(text);

  expect(await ftsMatches(query)).toBe(true);
  expect(inMemoryMatches({ text, query })).toBe(true);
});

// A split here builds `i* AND stanbul*`, which matches the stored `istanbul` in neither half.
test.each(COMBINING_MARK_CASES)(
  "$language: $query stays one token and finds the row",
  async ({ text, query }) => {
    await indexBody(text);

    expect(tokenizeSearchQuery(query)).toHaveLength(1);
    expect(await ftsMatches(query)).toBe(true);
    expect(inMemoryMatches({ text, query })).toBe(true);
  },
);

// The one place the halves are allowed to differ, and only in this direction: SQLite folds no Greek
// tonos, so an untoned query reaches a docs route but not a CMS entry. Pinned so a future tokenizer
// change cannot quietly make the in-memory half the narrower of the two.
test("the in-memory half never matches less than FTS5", async () => {
  const text = "Τεκμηρίωση";
  await indexBody(text);

  expect(await ftsMatches("τεκμηριωση")).toBe(false);
  expect(inMemoryMatches({ text, query: "τεκμηριωση" })).toBe(true);
});
