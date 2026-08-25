// Docs search answers from two indexes: the FTS5 table of CMS entries and the in-memory index of
// the docs pages that are app routes. They tokenize here so one query cannot match different words
// in each half of the results.
//
// The two need different treatment, because only one of them has a tokenizer of its own. FTS5
// normalizes with `unicode61 remove_diacritics 2`, and it applies that to the index and to the
// query alike, so it is handed tokens that are only split and lowercased. The in-memory index has
// nothing of the sort, so it folds both its text and its queries here to imitate the same rules.

/** Extra terms buy nothing and cost an FTS5 clause each. */
const MAX_SEARCH_TOKENS = 6;

// Unicode letters and digits, not `[a-z0-9]`: an ASCII-only class cuts an accented word in two
// (`documentación` becomes `documentaci` and `n`) and tokenizes a non-Latin catalog to nothing.
// Combining marks join the class because `toLowerCase` makes them: `İ` becomes `i` plus U+0307, and
// without `\p{M}` the word breaks there and the FTS5 query finds nothing.
const TOKEN_PATTERN = /[\p{L}\p{N}\p{M}]+/gu;

/** Combining marks, which NFD splits an accented letter into. */
const COMBINING_MARKS = /\p{M}+/gu;

function splitTokens(text: string): string[] {
  return text.toLowerCase().match(TOKEN_PATTERN) ?? [];
}

/**
 * Tokens for the FTS5 `MATCH` clause, split and lowercased but never folded.
 *
 * `unicode61` strips the diacritics of the stored text and of the query with one table, so folding
 * first can only do harm: SQLite folds no Greek tonos, and `τεκμηρίωση*` pre-folded to
 * `τεκμηριωση*` stops matching a row it would otherwise have found.
 *
 * A token may hold a combining mark, and that is safe: FTS5 tokenizes the `MATCH` string with the
 * same table, so `i̇stanbul*` reaches the index as `istanbul*`.
 */
export function tokenizeSearchQuery(query: string): string[] {
  return splitTokens(query).slice(0, MAX_SEARCH_TOKENS);
}

/**
 * Text of the in-memory docs-route index, folded to imitate `unicode61 remove_diacritics 2`.
 *
 * NFD splits an accented letter into its base plus a combining mark, and dropping the marks leaves
 * the base — so `documentacion` finds `Documentación`, which is how people actually type Spanish.
 * Not an exact replica: this also folds Greek tonos, which SQLite does not, so an untoned query
 * reaches a docs route but not a CMS entry. This half may match more than FTS5, never less, or a
 * result would vanish from one side of the page.
 */
export function tokenizeIndexText(text: string): string[] {
  return splitTokens(text.normalize("NFD").replace(COMBINING_MARKS, ""));
}

/** A query for that same index, folded identically and capped like the FTS5 one. */
export function tokenizeIndexQuery(query: string): string[] {
  return tokenizeIndexText(query).slice(0, MAX_SEARCH_TOKENS);
}

/** Mirrors the `token*` prefix matching of the FTS5 query. */
export function hasPrefixMatch({
  tokens,
  queryToken,
}: {
  tokens: readonly string[];
  queryToken: string;
}): boolean {
  return tokens.some((token) => token.startsWith(queryToken));
}
