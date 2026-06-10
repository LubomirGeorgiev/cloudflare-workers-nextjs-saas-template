export const MIN_QUERY_LENGTH = 2;

export interface HighlightMatcher {
  terms: string[];
  termSet: Set<string>;
  pattern: RegExp | null;
}

interface HighlightedTextSegment {
  text: string;
  highlighted: boolean;
}

export function createHighlightMatcher(query: string): HighlightMatcher {
  const terms = getHighlightTerms(query);

  return {
    terms,
    termSet: new Set(terms.map((term) => term.toLowerCase())),
    pattern:
      terms.length > 0
        ? new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi")
        : null,
  };
}

export function splitHighlightedText({
  text,
  matcher,
}: {
  text: string;
  matcher: HighlightMatcher;
}): HighlightedTextSegment[] {
  if (!matcher.pattern) {
    return [{ text, highlighted: false }];
  }

  return text
    .split(matcher.pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      highlighted: matcher.termSet.has(part.toLowerCase()),
    }));
}

function getHighlightTerms(query: string) {
  return Array.from(
    new Set(
      query
        .trim()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= MIN_QUERY_LENGTH)
        .sort((left, right) => right.length - left.length)
    )
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
