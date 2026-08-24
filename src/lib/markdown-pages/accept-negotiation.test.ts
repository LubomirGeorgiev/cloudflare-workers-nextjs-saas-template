import { describe, expect, test } from "vitest";

import { ACCEPT_VARY_FIELD } from "@/constants";
import {
  MARKDOWN_NEGOTIATION_CACHE_CONTROL,
  MARKDOWN_PAGE_CACHE_TTL_SECONDS,
} from "@/constants/cache-control";
import { STATIC_PUBLIC_ROUTES } from "@/constants/public-routes";
import { ENABLED_LOCALES } from "@/i18n/config";

import { markdownNegotiationRedirect } from "./accept-negotiation";
import { buildMarkdownPagePath, localizedPagePathname } from "./page-paths";

/** What a browser sends, and what nothing here may ever redirect. */
const BROWSER_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

const PAGE_PATHNAME = STATIC_PUBLIC_ROUTES[0]!.pathname;

/** The page always has a Markdown twin, so only the `Accept` header decides the answer. */
function redirectsFor(accept: string | null): boolean {
  return markdownNegotiationRedirect({ accept, pathname: PAGE_PATHNAME }) !== null;
}

describe("accept header matching", () => {
  test("accepts a header that names only Markdown", () => {
    expect(redirectsFor("text/markdown")).toBe(true);
    expect(redirectsFor(" TEXT/MARKDOWN ; charset=utf-8 ")).toBe(true);
  });

  test("rejects a browser header and a missing header", () => {
    expect(redirectsFor(BROWSER_ACCEPT)).toBe(false);
    expect(redirectsFor(null)).toBe(false);
    expect(redirectsFor("")).toBe(false);
  });

  test("never reads a wildcard as a request for Markdown", () => {
    expect(redirectsFor("*/*")).toBe(false);
    expect(redirectsFor("text/*")).toBe(false);
  });

  test("redirects for any Markdown range above q=0", () => {
    expect(redirectsFor("text/markdown;q=0.9, text/html;q=0.8")).toBe(true);
    expect(redirectsFor("text/markdown;q=0")).toBe(false);
    expect(redirectsFor("text/markdown, */*")).toBe(true);
    // The rule no longer ranks Markdown against HTML: a named Markdown range wins on its own.
    expect(redirectsFor("text/html, text/markdown;q=0.5")).toBe(true);
    expect(redirectsFor("text/markdown;q=0.5, application/xhtml+xml")).toBe(true);
    expect(redirectsFor("text/markdown;q=0, text/markdown")).toBe(true);
  });

  test("ignores media-type parameters other than q", () => {
    expect(redirectsFor("text/markdown;charset=utf-8")).toBe(true);
  });

  test("matches the exact range only", () => {
    expect(redirectsFor("application/vnd.markdown")).toBe(false);
    expect(redirectsFor("text/markdownish")).toBe(false);
  });

  test("falls back to q=1 when the parameter is unusable", () => {
    expect(redirectsFor("text/markdown;q=high, text/html;q=0.9")).toBe(true);
  });
});

// One equality, but on the derived string, so a fork may retune the seconds. `no-store` is the
// regression this guards: it dropped the whole cache entry and every `vary: accept` variant with it,
// so one agent request cold-flushed the page HTML. See docs/page-caching.md.
test("stays shared-storable", () => {
  expect(MARKDOWN_NEGOTIATION_CACHE_CONTROL).toBe(
    `public, max-age=0, s-maxage=${MARKDOWN_PAGE_CACHE_TTL_SECONDS}`,
  );
});

describe("markdownNegotiationRedirect", () => {
  test("sends a public page to its .md twin under the shared cache policy", () => {
    const redirect = markdownNegotiationRedirect({
      accept: "text/markdown",
      pathname: PAGE_PATHNAME,
    });

    expect(redirect?.status).toBe(303);
    expect(redirect?.headers.get("location")).toBe(
      buildMarkdownPagePath({ pathname: PAGE_PATHNAME }),
    );
    expect(redirect?.headers.get("cache-control")).toBe(MARKDOWN_NEGOTIATION_CACHE_CONTROL);
    expect(redirect?.headers.get("vary")).toBe(ACCEPT_VARY_FIELD);
  });

  test("keeps the locale prefix of the page it redirects", () => {
    for (const locale of ENABLED_LOCALES) {
      const pathname = localizedPagePathname({ locale, pathname: PAGE_PATHNAME });

      expect(markdownNegotiationRedirect({ accept: "text/markdown", pathname })?.headers.get("location"))
        .toBe(buildMarkdownPagePath({ pathname }));
    }
  });

  test("declines a path with no Markdown twin", () => {
    expect(
      markdownNegotiationRedirect({ accept: "text/markdown", pathname: "/dashboard" }),
    ).toBeNull();
    expect(
      markdownNegotiationRedirect({ accept: "text/markdown", pathname: "/api/v1/teams" }),
    ).toBeNull();
  });

  test("declines a browser request for a page that has a twin", () => {
    expect(
      markdownNegotiationRedirect({ accept: BROWSER_ACCEPT, pathname: PAGE_PATHNAME }),
    ).toBeNull();
  });
});
