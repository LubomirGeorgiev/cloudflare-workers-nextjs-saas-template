import { MARKDOWN_NEGOTIATION_CACHE_CONTROL } from "@/constants/cache-control";

import { markdownAlternateFor, MARKDOWN_CONTENT_TYPE } from "./markdown-alternate";

// 303, not 301/302: this URL did not move. The Markdown twin is a second representation with its
// own URL, and the agent asked for that representation, so send it there for this request only.
const MARKDOWN_NEGOTIATION_STATUS = 303;

/**
 * True when the caller names `text/markdown` as an exact media range with a `q` above 0.
 *
 * A wildcard never counts as naming Markdown: an all-types header is what curl and most HTTP
 * libraries send by default, and those callers want the page.
 */
function prefersMarkdownRepresentation(accept: string | null): boolean {
  if (!accept) {
    return false;
  }

  return accept.split(",").some((entry) => {
    const [range, ...parameters] = entry.split(";");

    if (range?.trim().toLowerCase() !== MARKDOWN_CONTENT_TYPE) {
      return false;
    }

    return parseQuality(parameters) > 0;
  });
}

/** The redirect for a page whose caller wants Markdown, or `null` when it has no `.md` twin. */
export function markdownNegotiationRedirect({
  accept,
  pathname,
}: {
  accept: string | null;
  pathname: string;
}): Response | null {
  if (!prefersMarkdownRepresentation(accept)) {
    return null;
  }

  const alternate = markdownAlternateFor({ pathname });
  if (!alternate) {
    return null;
  }

  return new Response(null, {
    status: MARKDOWN_NEGOTIATION_STATUS,
    headers: {
      // Relative on purpose: an absolute location resolves against the build-time `SITE_URL` and
      // would send a preview deployment to production.
      location: alternate.path,
      "cache-control": MARKDOWN_NEGOTIATION_CACHE_CONTROL,
      vary: "accept",
    },
  });
}

// Media-type parameters and accept-extensions are ignored; only `q` changes which representation
// wins. An unparsable or out-of-range `q` falls back to the RFC 9110 default of 1.
function parseQuality(parameters: string[]): number {
  for (const parameter of parameters) {
    const separator = parameter.indexOf("=");
    if (separator === -1 || parameter.slice(0, separator).trim().toLowerCase() !== "q") {
      continue;
    }

    const quality = Number.parseFloat(parameter.slice(separator + 1));

    return Number.isNaN(quality) ? 1 : Math.min(Math.max(quality, 0), 1);
  }

  return 1;
}
