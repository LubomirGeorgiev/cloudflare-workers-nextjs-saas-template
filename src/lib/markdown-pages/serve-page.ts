import {
  MARKDOWN_PAGE_CACHE_CONTROL,
  MARKDOWN_PAGE_CACHE_TTL_SECONDS,
} from "@/constants/cache-control";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER } from "@/utils/request-protocol";

import { convertHtmlToMarkdown } from "./convert-html";
import { markdownDownloadDisposition } from "./download-filename";
import { buildMarkdownPageCacheKey } from "./page-cache";
import { buildAbsoluteSourcePageUrl } from "./page-paths";
import type { MarkdownBranchParams, MdRequestTarget } from "./index";

// Restated rather than imported from `@/lib/api/errors`: that module drags the ActionError and
// rate-limit graph onto this lazily loaded chunk for one string.
const PROBLEM_JSON_CONTENT_TYPE = "application/problem+json";

/** Public contract: a caller branches on this code, never on the prose next to it. */
export const MARKDOWN_UNAVAILABLE_CODE = "MARKDOWN_UNAVAILABLE";
export const MARKDOWN_UNAVAILABLE_STATUS = 406;

// A page the converter cannot frame today may convert after the next deploy, so no cache may keep
// this answer: not KV, and not a shared cache.
const MARKDOWN_UNAVAILABLE_CACHE_CONTROL = "no-store";

function markdownResponse({
  body,
  pathname,
  wantsDownload,
}: {
  body: string;
  pathname: string;
  wantsDownload: boolean;
}): Response {
  const headers: Record<string, string> = {
    "cache-control": MARKDOWN_PAGE_CACHE_CONTROL,
    "content-type": "text/markdown; charset=utf-8",
  };

  // Set here, not before the cache read: the cache key is pathname-only, so a cached hit must get
  // the header too, and the flag must never change the cached body.
  if (wantsDownload) {
    headers["content-disposition"] = markdownDownloadDisposition({ subject: pathname });
  }

  return new Response(body, { headers });
}

// RFC 9457 shape without `type`: it defaults to "about:blank", and this code is not in the public
// API catalog `/docs/api/errors` documents, so a link there would be a dead anchor.
function markdownUnavailableResponse({ sourceUrl }: { sourceUrl: string }): Response {
  return new Response(
    JSON.stringify({
      title: "Not acceptable",
      status: MARKDOWN_UNAVAILABLE_STATUS,
      code: MARKDOWN_UNAVAILABLE_CODE,
      detail: `This page has no Markdown representation. Read the HTML page at ${sourceUrl} instead.`,
    }),
    {
      status: MARKDOWN_UNAVAILABLE_STATUS,
      headers: {
        "cache-control": MARKDOWN_UNAVAILABLE_CACHE_CONTROL,
        "content-type": PROBLEM_JSON_CONTENT_TYPE,
      },
    },
  );
}

// The only caller header the internal render may see. It is the origin's own protocol, which the
// Worker derives from the URL, so it is the same for every caller and decides the `Secure` flag of
// any cookie the render writes.
const FORWARDED_PAGE_REQUEST_HEADERS = [__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER] as const;

// Built from a fixed set, never cloned from the caller: the page Markdown cache key is
// pathname-only, so a render that could vary by a request header would serve the first requester's
// variant to everyone. No cookie, so nothing is personalized; the pathname carries the locale.
function internalPageRequest({
  request,
  pathname,
}: {
  request: Request;
  pathname: string;
}): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = "";

  const headers = new Headers({
    accept: "text/html",
    "accept-language": DEFAULT_LOCALE,
  });

  for (const name of FORWARDED_PAGE_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  return new Request(url, { headers, method: "GET" });
}

// fallow-ignore-next-line unused-export -- Reached by dynamic import from index.ts.
export async function servePageMarkdown({
  target,
  request,
  env,
  ctx,
  render,
  wantsDownload,
}: MarkdownBranchParams & { target: Extract<MdRequestTarget, { type: "page" }> }) {
  const cacheKey = buildMarkdownPageCacheKey({ pathname: target.pathname });
  const cached = await env.NEXT_INC_CACHE_KV.get(cacheKey);

  if (cached) {
    return markdownResponse({ body: cached, pathname: target.pathname, wantsDownload });
  }

  const rendered = await render(
    internalPageRequest({ request, pathname: target.pathname }),
    env,
    ctx,
  );
  const isHtmlPage =
    rendered.status === 200 && Boolean(rendered.headers.get("content-type")?.includes("text/html"));

  if (!isHtmlPage) {
    return rendered;
  }

  const html = await rendered.text();
  const sourceUrl = buildAbsoluteSourcePageUrl({ pathname: target.pathname });
  const markdown = await convertHtmlToMarkdown({ sourceUrl, html });

  // The page rendered, so a conversion its shape defeats is not a 500, and the page exists, so it
  // is not a 404 either: it has no Markdown representation. Never serve HTML under a `.md` URL.
  if (markdown === null) {
    return markdownUnavailableResponse({ sourceUrl });
  }

  // Off the response path: a cache write must not add latency to, or fail, a page that rendered.
  ctx.waitUntil(
    env.NEXT_INC_CACHE_KV.put(cacheKey, markdown, {
      expirationTtl: MARKDOWN_PAGE_CACHE_TTL_SECONDS,
    }).catch(() => undefined),
  );

  return markdownResponse({ body: markdown, pathname: target.pathname, wantsDownload });
}
