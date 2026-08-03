// The contract between the server-rendered reference and the client-side filter. Every operation
// is fully rendered on the server; the filter only hides nodes, so it needs the haystack and the
// method to travel in the markup rather than in a second copy of the document sent to the browser.

/** Lowercased haystack; also the marker attribute the filter selects on. */
const OPERATION_ATTRIBUTE = "data-api-operation";
const INDEX_ATTRIBUTE = "data-api-index";
const METHOD_ATTRIBUTE = "data-api-method";
const GROUP_ATTRIBUTE = "data-api-group";
const EMPTY_STATE_ATTRIBUTE = "data-api-empty";

export const API_FILTER_SELECTORS = {
  operation: `[${OPERATION_ATTRIBUTE}]`,
  index: `[${INDEX_ATTRIBUTE}]`,
  group: `[${GROUP_ATTRIBUTE}]`,
  emptyState: `[${EMPTY_STATE_ATTRIBUTE}]`,
} as const;

export const API_FILTER_ATTRIBUTE_NAMES = {
  haystack: OPERATION_ATTRIBUTE,
  indexHaystack: INDEX_ATTRIBUTE,
  method: METHOD_ATTRIBUTE,
} as const;

/**
 * Attributes the client filter matches on. An operation card and its entry in the endpoint index
 * carry the same search text under different attributes, so both stay in sync by construction.
 */
export function filterAttributes({
  target,
  searchText,
  method,
}: {
  target: "operation" | "index";
  searchText: string;
  method: string;
}): Record<string, string> {
  const haystackAttribute = target === "operation" ? OPERATION_ATTRIBUTE : INDEX_ATTRIBUTE;

  return { [haystackAttribute]: searchText, [METHOD_ATTRIBUTE]: method };
}

/** A tag section, hidden once every operation inside it is filtered out. */
export const GROUP_FILTER_ATTRIBUTES: Record<string, string> = { [GROUP_ATTRIBUTE]: "" };

export const EMPTY_STATE_ATTRIBUTES: Record<string, string> = { [EMPTY_STATE_ATTRIBUTE]: "" };

// Method colors are shared by the badges and by the filter chips, so a chip always reads as the
// same color as the operations it keeps.
const METHOD_STYLES: Record<string, string> = {
  GET: "bg-emerald-500/10 text-emerald-700 ring-emerald-600/25 dark:text-emerald-300 dark:ring-emerald-400/25",
  POST: "bg-sky-500/10 text-sky-700 ring-sky-600/25 dark:text-sky-300 dark:ring-sky-400/25",
  PUT: "bg-violet-500/10 text-violet-700 ring-violet-600/25 dark:text-violet-300 dark:ring-violet-400/25",
  PATCH: "bg-amber-500/10 text-amber-700 ring-amber-600/25 dark:text-amber-300 dark:ring-amber-400/25",
  DELETE: "bg-rose-500/10 text-rose-700 ring-rose-600/25 dark:text-rose-300 dark:ring-rose-400/25",
};

const FALLBACK_METHOD_STYLE = "bg-muted text-muted-foreground ring-border";

export function methodStyle(method: string): string {
  return METHOD_STYLES[method] ?? FALLBACK_METHOD_STYLE;
}
