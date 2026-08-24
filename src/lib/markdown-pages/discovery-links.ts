import { HTML_DISCOVERY_RELATIONS, LLMS_DESCRIBED_BY_RELATION } from "@/constants";

import { markdownAlternateFor, MARKDOWN_CONTENT_TYPE } from "./markdown-alternate";

/** Formats one relation as an RFC 8288 `Link` value. Takes the constant, never a raw URL. */
function linkValue({ href, rel, type }: { href: string; rel: string; type: string }): string {
  return `<${href}>; rel="${rel}"; type="${type}"`;
}

// Kept separate from the list below: a Markdown response advertises this relation on its own.
export const LLMS_DESCRIBED_BY_LINK = linkValue(LLMS_DESCRIBED_BY_RELATION);
/** The header form of the set the shell renders as `<link>`s, so neither channel can drift. */
export const HTML_DISCOVERY_LINKS: readonly string[] = HTML_DISCOVERY_RELATIONS.map(linkValue);

/** The separator RFC 8288 uses between values of one `Link` header, and the one we write back. */
const LINK_VALUE_SEPARATOR = ", ";

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
  const existing = current ? current.split(LINK_VALUE_SEPARATOR) : [];
  const additions = values.filter((value) => !existing.includes(value));

  if (additions.length === 0) {
    return false;
  }

  headers.set("link", [...existing, ...additions].join(LINK_VALUE_SEPARATOR));

  return true;
}

/** Adds the root llms.txt relation to headers a caller already owns. */
export function applyLlmsDescribedByLink(headers: Headers): boolean {
  return appendLinkHeaderValues({ headers, values: [LLMS_DESCRIBED_BY_LINK] });
}

// A response may carry immutable headers, so adding one means re-wrapping. Returns the original
// response untouched when there is nothing to add.
function withLinkHeader({
  response,
  values,
}: {
  response: Response;
  values: readonly string[];
}): Response {
  const headers = new Headers(response.headers);

  if (!appendLinkHeaderValues({ headers, values })) {
    return response;
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/**
 * The discovery relations an HTML response advertises. `ok` gates the Markdown alternate: a 404 or
 * a 500 has no `.md` twin, and the advertised URL would fail the same way. llms.txt and the API
 * catalog exist whatever this response is, so those two ride on an error page too.
 */
export function htmlDiscoveryLinkValues({
  ok,
  pathname,
}: {
  ok: boolean;
  pathname: string;
}): string[] {
  const alternate = ok ? markdownAlternateFor({ pathname }) : null;

  if (!alternate) {
    return [...HTML_DISCOVERY_LINKS];
  }

  return [
    `<${alternate.url}>; rel="alternate"; type="${MARKDOWN_CONTENT_TYPE}"`,
    ...HTML_DISCOVERY_LINKS,
  ];
}

export function withHtmlDiscoveryLinkHeader({
  pathname,
  response,
}: {
  pathname: string;
  response: Response;
}): Response {
  return withLinkHeader({
    response,
    values: htmlDiscoveryLinkValues({ ok: response.ok, pathname }),
  });
}

export function withLlmsDescribedByLinkHeader({ response }: { response: Response }): Response {
  return withLinkHeader({ response, values: [LLMS_DESCRIBED_BY_LINK] });
}
