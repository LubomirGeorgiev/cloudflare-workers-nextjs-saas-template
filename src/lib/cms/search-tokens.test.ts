// The two indexes behind docs search normalize differently on purpose — FTS5 folds a query itself,
// the in-memory one cannot — so both halves are pinned here.
// `tests/integration/cms-search-tokenizer.test.ts` replays the same words against real FTS5.

import { expect, test } from "vitest";

import {
  hasPrefixMatch,
  tokenizeIndexQuery,
  tokenizeIndexText,
  tokenizeSearchQuery,
} from "./search-tokens";

const MAX_SEARCH_TOKENS = 6;

test("splits on punctuation and whitespace, and lowercases", () => {
  expect(tokenizeSearchQuery("API keys, OAuth 2.1!")).toEqual(["api", "keys", "oauth", "2", "1"]);
});

// `[a-z0-9]` cut these in two, which silently made an accented or non-Latin catalog unsearchable.
test.each([
  ["Spanish", "Documentación", "documentación"],
  ["Bulgarian", "Удостоверяване", "удостоверяване"],
  ["Japanese", "ドキュメント", "ドキュメント"],
])("keeps a %s word whole for FTS5", (_language, text, expected) => {
  expect(tokenizeSearchQuery(text)).toEqual([expected]);
});

// FTS5 folds the stored text and the query with one table, so a token handed to it must arrive
// unfolded — SQLite folds no Greek tonos, and pre-folding turns a hit into a miss.
test("does not fold the tokens FTS5 receives", () => {
  expect(tokenizeSearchQuery("Τεκμηρίωση")).toEqual(["τεκμηρίωση"]);
});

// `toLowerCase` turns `İ` into `i` plus a combining dot, and NFD input already carries marks. A
// token class without `\p{M}` broke the word there, and `i* AND stanbul*` matched no row at all.
const MARK_CASES: Array<{ language: string; text: string }> = [
  { language: "Turkish", text: "İstanbul" },
  { language: "Turkish", text: "İçerik" },
  { language: "Spanish NFD", text: "documentación".normalize("NFD") },
  { language: "Greek NFD", text: "Τεκμηρίωση".normalize("NFD") },
];

test.each(MARK_CASES)("keeps $language $text whole for FTS5", ({ text }) => {
  expect(tokenizeSearchQuery(text)).toEqual([text.toLowerCase()]);
});

// The in-memory half strips the marks before it splits, so the wider class changes nothing here.
test.each(MARK_CASES)("folds $language $text to one bare token", ({ text }) => {
  const tokens = tokenizeIndexText(text);

  expect(tokens).toHaveLength(1);
  expect(tokens[0]).toMatch(/^[\p{L}\p{N}]+$/u);
});

// Neither half may split a word the other keeps whole, or a hit shows on one side of the page only.
test.each([...MARK_CASES, { language: "Spanish", text: "Documentación" }])(
  "both halves make one token from $language $text",
  ({ text }) => {
    expect(tokenizeSearchQuery(text)).toHaveLength(1);
    expect(tokenizeIndexText(text)).toHaveLength(1);
  },
);

test.each([
  ["Spanish", "Documentación", "documentacion"],
  ["French", "Créer un compte", "creer"],
  ["Romanian", "Înregistrare", "inregistrare"],
  ["Turkish", "Şifre", "sifre"],
  ["Polish", "Zarządzanie", "zarzadzanie"],
  ["Vietnamese", "Tài liệu", "lieu"],
])("folds %s diacritics for the in-memory index", (_language, text, expected) => {
  expect(tokenizeIndexText(text)).toContain(expected);
});

test("an unaccented query prefix-matches accented text in the in-memory index", () => {
  const tokens = tokenizeIndexText("Documentación de la API");
  const [queryToken] = tokenizeIndexQuery("documentaci");

  expect(hasPrefixMatch({ tokens, queryToken: queryToken as string })).toBe(true);
});

test.each([
  ["FTS5", tokenizeSearchQuery],
  ["in-memory", tokenizeIndexQuery],
])("caps a %s query, because every extra term costs a clause", (_half, tokenize) => {
  const query = Array.from({ length: MAX_SEARCH_TOKENS + 3 }, (_unused, index) => `t${index}`);

  expect(tokenize(query.join(" "))).toHaveLength(MAX_SEARCH_TOKENS);
});

// Every token reaches FTS5 as `token*`, so one carrying an operator would change the query.
test("no token carries an FTS5 operator", () => {
  const tokens = tokenizeSearchQuery(`"quoted" (grouped) col:on star* NOT-hyphen ^caret`);

  expect(tokens.every((token) => /^[\p{L}\p{N}]+$/u.test(token))).toBe(true);
});

test("prefix matching mirrors the FTS5 `token*` form", () => {
  expect(hasPrefixMatch({ tokens: ["документация"], queryToken: "докум" })).toBe(true);
  expect(hasPrefixMatch({ tokens: ["документация"], queryToken: "ументация" })).toBe(false);
});
