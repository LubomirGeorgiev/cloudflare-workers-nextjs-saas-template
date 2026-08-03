// Docs search runs over two indexes — the FTS5 table of CMS entries and the in-memory index of the
// docs pages that are app routes. Both tokenize here so one query cannot match different words in
// each half of the results.

/** Extra terms buy nothing and cost an FTS5 clause each. */
const MAX_SEARCH_TOKENS = 6;
const TOKEN_PATTERN = /[a-z0-9]+/g;

export function tokenizeSearchQuery(query: string): string[] {
  return tokenizeSearchText(query).slice(0, MAX_SEARCH_TOKENS);
}

export function tokenizeSearchText(text: string): string[] {
  return text.toLowerCase().match(TOKEN_PATTERN) ?? [];
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
