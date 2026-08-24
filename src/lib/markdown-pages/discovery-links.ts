import {
  ACCEPT_VARY_FIELD,
  HTML_DISCOVERY_RELATIONS,
  LLMS_DESCRIBED_BY_RELATION,
} from "@/constants";

import type { MarkdownAlternate } from "./markdown-alternate";
import { markdownAlternateFor, MARKDOWN_CONTENT_TYPE } from "./markdown-alternate";

/** Formats one relation as an RFC 8288 `Link` value. Takes the constant, never a raw URL. */
function linkValue({ href, rel, type }: { href: string; rel: string; type: string }): string {
  return `<${href}>; rel="${rel}"; type="${type}"`;
}

// Kept separate from the list below: a Markdown response advertises this relation on its own.
export const LLMS_DESCRIBED_BY_LINK = linkValue(LLMS_DESCRIBED_BY_RELATION);
/** The header form of the set the shell renders as `<link>`s, so neither channel can drift. */
export const HTML_DISCOVERY_LINKS: readonly string[] = HTML_DISCOVERY_RELATIONS.map(linkValue);

/** The separator both `Link` and `Vary` use between values, and the one we write back. */
const HEADER_LIST_SEPARATOR = ", ";

/**
 * Adds the values the header does not already carry, and reports whether it changed anything.
 * Mutates: the caller owns the `Headers` object, so nothing has to clone a whole `Response`.
 */
export function appendLinkHeaderValues({
  headers,
  values,
}: {
  headers: Headers;
  values: readonly string[];
}): boolean {
  const current = headers.get("link");
  const existing = current ? current.split(HEADER_LIST_SEPARATOR) : [];
  const additions = values.filter((value) => !existing.includes(value));

  if (additions.length === 0) {
    return false;
  }

  headers.set("link", [...existing, ...additions].join(HEADER_LIST_SEPARATOR));

  return true;
}

/**
 * Adds `accept` to `Vary` without replacing tokens already on the response (Vinext lists RSC
 * fields). Matches case-insensitively, which is why `Link` keeps its own appender above.
 */
function applyAcceptVary(headers: Headers): boolean {
  const current = headers.get("vary");
  const tokens = current
    ? current.split(",").map((token) => token.trim()).filter(Boolean)
    : [];

  // `*` already means every request header, so it needs nothing added.
  if (tokens.some((token) => token === "*" || token.toLowerCase() === ACCEPT_VARY_FIELD)) {
    return false;
  }

  headers.set("vary", [...tokens, ACCEPT_VARY_FIELD].join(HEADER_LIST_SEPARATOR));
  return true;
}

/** Adds the root llms.txt relation to headers a caller already owns. */
export function applyLlmsDescribedByLink(headers: Headers): boolean {
  return appendLinkHeaderValues({ headers, values: [LLMS_DESCRIBED_BY_LINK] });
}

// A response may carry immutable headers, so changing one means re-wrapping. Returns the original
// response untouched when `apply` changed nothing.
function withHeaderChanges({
  apply,
  response,
}: {
  apply: (headers: Headers) => boolean;
  response: Response;
}): Response {
  const headers = new Headers(response.headers);

  if (!apply(headers)) {
    return response;
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/**
 * The discovery relations an HTML response advertises. A 404 or a 500 gets a `null` alternate: its
 * `.md` twin fails the same way. llms.txt and the API catalog exist whatever this response is, so
 * those two ride on an error page too.
 */
function htmlDiscoveryLinkValues(alternate: MarkdownAlternate | null): string[] {
  if (!alternate) {
    return [...HTML_DISCOVERY_LINKS];
  }

  return [
    `<${alternate.url}>; rel="alternate"; type="${MARKDOWN_CONTENT_TYPE}"`,
    ...HTML_DISCOVERY_LINKS,
  ];
}

/**
 * Stamps the discovery `Link`s, plus `vary: accept` when this URL really has two representations.
 */
export function withHtmlDiscoveryLinkHeader({
  pathname,
  response,
}: {
  pathname: string;
  response: Response;
}): Response {
  const alternate = response.ok ? markdownAlternateFor({ pathname }) : null;

  return withHeaderChanges({
    response,
    apply: (headers) => {
      const linked = appendLinkHeaderValues({
        headers,
        values: htmlDiscoveryLinkValues(alternate),
      });
      const varied = alternate ? applyAcceptVary(headers) : false;

      return linked || varied;
    },
  });
}

export function withLlmsDescribedByLinkHeader({ response }: { response: Response }): Response {
  return withHeaderChanges({ response, apply: applyLlmsDescribedByLink });
}
