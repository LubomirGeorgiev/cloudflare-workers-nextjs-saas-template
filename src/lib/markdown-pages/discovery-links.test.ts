import { describe, expect, test, vi } from "vitest";

import { API_DOCS_PATH, SITE_URL } from "@/constants";
import { BLOG_LISTING_ROUTES } from "@/constants/public-routes";

vi.mock("server-only", () => ({}));

// The relations have one definition, so the expected values come from it rather than a copy.
const {
  appendLinkHeaderValues,
  HTML_DISCOVERY_LINKS,
  LLMS_DESCRIBED_BY_LINK: DESCRIBED_BY,
  withHtmlDiscoveryLinkHeader,
  withLlmsDescribedByLinkHeader,
} = await import("./discovery-links");
/** Every HTML response carries the whole set, whatever its status. */
const ALWAYS_ADVERTISED = HTML_DISCOVERY_LINKS.join(", ");
const API_DOCS_ALTERNATE =
  `<${SITE_URL}${API_DOCS_PATH}.md>; rel="alternate"; type="text/markdown"`;

/** A syntactically resolvable `.md` target under an entry collection, so only `ok` can gate it. */
const MISSING_BLOG_PATHNAME = `${BLOG_LISTING_ROUTES[0]!.pathname}/no-such-entry`;

function htmlResponse(init?: ResponseInit): Response {
  return new Response("page", {
    ...init,
    headers: { "content-type": "text/html", ...init?.headers },
  });
}

describe("agent discovery Link headers", () => {
  test("links a supported HTML page to its Markdown version and the root llms.txt", () => {
    const response = withHtmlDiscoveryLinkHeader({
      pathname: API_DOCS_PATH,
      response: htmlResponse(),
    });

    expect(response.headers.get("link")).toBe(`${API_DOCS_ALTERNATE}, ${ALWAYS_ADVERTISED}`);
  });

  test("only links the always-advertised relations when a page has no Markdown version", () => {
    const response = withHtmlDiscoveryLinkHeader({
      pathname: "/sign-in",
      response: new Response("page"),
    });

    expect(response.headers.get("link")).toBe(ALWAYS_ADVERTISED);
  });

  // The `.md` twin of a failed page fails the same way, so advertising it points agents at a 404.
  test.each([
    ["docs", "/docs/no-such-page"],
    ["blog", MISSING_BLOG_PATHNAME],
  ])("omits the Markdown alternate on a 404 %s page", (__collection, pathname) => {
    const response = withHtmlDiscoveryLinkHeader({
      pathname,
      response: htmlResponse({ status: 404 }),
    });

    expect(response.headers.get("link")).toBe(ALWAYS_ADVERTISED);
  });

  test("omits the Markdown alternate on a failed render of a supported page", () => {
    const response = withHtmlDiscoveryLinkHeader({
      pathname: API_DOCS_PATH,
      response: htmlResponse({ status: 500 }),
    });

    expect(response.headers.get("link")).toBe(ALWAYS_ADVERTISED);
  });

  test("preserves an existing Link header", () => {
    const response = withHtmlDiscoveryLinkHeader({
      pathname: API_DOCS_PATH,
      response: htmlResponse({
        headers: { link: `<${SITE_URL}${API_DOCS_PATH}>; rel="canonical"` },
      }),
    });

    expect(response.headers.get("link")).toBe(
      `<${SITE_URL}${API_DOCS_PATH}>; rel="canonical", ${API_DOCS_ALTERNATE}, ${ALWAYS_ADVERTISED}`,
    );
  });

  test("returns the same response when it already carries every value", () => {
    const original = htmlResponse({
      headers: { link: `${API_DOCS_ALTERNATE}, ${ALWAYS_ADVERTISED}` },
    });
    const response = withHtmlDiscoveryLinkHeader({ pathname: API_DOCS_PATH, response: original });

    expect(response).toBe(original);
  });

  test("adds the root llms.txt relation to a non-HTML response", () => {
    const response = withLlmsDescribedByLinkHeader({ response: new Response("markdown") });

    expect(response.headers.get("link")).toBe(DESCRIBED_BY);
  });
});

describe("appendLinkHeaderValues", () => {
  test("compares whole values, so a substring of an existing value is still added", () => {
    const headers = new Headers({ link: `<${SITE_URL}/a.md>; rel="alternate"; type="text/markdown"` });

    expect(appendLinkHeaderValues({ headers, values: [`<${SITE_URL}/a.md>; rel="alternate"`] }))
      .toBe(true);
    expect(headers.get("link")).toBe(
      `<${SITE_URL}/a.md>; rel="alternate"; type="text/markdown", ` +
        `<${SITE_URL}/a.md>; rel="alternate"`,
    );
  });

  test("reports no change when every value is already present", () => {
    const headers = new Headers({ link: DESCRIBED_BY });

    expect(appendLinkHeaderValues({ headers, values: [DESCRIBED_BY] })).toBe(false);
    expect(headers.get("link")).toBe(DESCRIBED_BY);
  });
});
