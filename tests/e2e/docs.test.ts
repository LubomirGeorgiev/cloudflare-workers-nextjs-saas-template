import { expect, test } from "vitest";
import {
  clickAppRole,
  expectAppPathname,
  expectAppRole,
  expectAppText,
  expectAppTextHidden,
  fetchAppPath,
  fillAppPlaceholder,
  getAppCurrentUrl,
  loadAppFrame,
} from "./app-frame";
import {
  API_AUTH_DOCS_PATH,
  API_DOCS_PATH,
  API_ERRORS_DOCS_PATH,
  API_OPENAPI_SPEC_PATH,
  HTML_DISCOVERY_RELATIONS,
  LLMS_TXT_PATH,
  MCP_DOCS_PATH,
  MCP_PATH,
  SITE_NAME,
} from "../../src/constants";
import { DEFAULT_LOCALE } from "../../src/i18n/config";
import { loadCatalog } from "../../src/i18n/message-catalogs";
import { parseMarkdownPagePath } from "../../src/lib/markdown-pages/page-paths";
import { SEEDED_DOCS_ENTRY, SEEDED_DOCS_ENTRY_PATH } from "./seed-fixtures";
import { escapeRegExp } from "../../src/utils/escape-regexp";

const defaultMessages = await loadCatalog(DEFAULT_LOCALE);

/** Every `<link>` element of one relation, whatever order the renderer writes its attributes. */
function discoveryLinkPattern(rel: string): RegExp {
  return new RegExp(`<link[^>]+rel="${escapeRegExp(rel)}"[^>]*>`, "g");
}

/** Every question the landing accordion renders, read from the catalog rather than restated here. */
function faqQuestions(messages: typeof defaultMessages): string[] {
  return Object.values(messages.Landing.Faq).flatMap((entry) =>
    typeof entry === "object" && "question" in entry ? [entry.question] : [],
  );
}

test("renders seeded docs navigation content from fresh D1 state", async () => {
  await loadAppFrame(SEEDED_DOCS_ENTRY_PATH);

  await expectAppRole("heading", SEEDED_DOCS_ENTRY.title, { exact: true });
  await expectAppText(
    "Learn how this template is structured and how to ship your first feature quickly."
  );
});

test("redirects the docs root to the first navigable docs page", async () => {
  await loadAppFrame("/docs");

  await expectAppPathname(SEEDED_DOCS_ENTRY_PATH);
  await expectAppRole("heading", SEEDED_DOCS_ENTRY.title, { exact: true });
});

test("honors seeded docs navigation redirects", async () => {
  await loadAppFrame("/docs/getting-started/setup");

  await expectAppPathname(SEEDED_DOCS_ENTRY_PATH);
  await expectAppRole("heading", SEEDED_DOCS_ENTRY.title, { exact: true });
});

test("serves a docs page as markdown at its .md URL", async () => {
  const response = await fetchAppPath(`${SEEDED_DOCS_ENTRY_PATH}.md`, { redirect: "manual" });

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^text\/markdown\b/);
  expect(response.headers.get("link")).toContain(`${LLMS_TXT_PATH}>; rel="describedby"`);
  await expect(response.text()).resolves.toContain("Authentication and team management");
});

// The Worker stamps every discovery relation on a `text/html` response, and the shell repeats the
// same set in the DOM for agents that read markup instead of headers. React must hoist that one
// copy into `<head>` during the server render, so the slice below is where the only match may
// appear. The set comes from the shared list, so a relation dropped from either channel fails here.
test("advertises the API Markdown page and every discovery relation in HTML and HTTP links", async () => {
  const response = await fetchAppPath(API_DOCS_PATH);
  const link = response.headers.get("link") ?? "";
  const html = await response.text();

  expect(link).toContain(`${API_DOCS_PATH}.md>; rel="alternate"; type="text/markdown"`);
  expect(html).toMatch(
    new RegExp(`<link[^>]+href="[^"]*${API_DOCS_PATH}\\.md"[^>]+type="text/markdown"[^>]*>`),
  );

  const headEnd = html.indexOf("</head>");
  expect(headEnd).toBeGreaterThan(-1);

  const head = html.slice(0, headEnd);
  expect(HTML_DISCOVERY_RELATIONS.length).toBeGreaterThan(0);

  for (const relation of HTML_DISCOVERY_RELATIONS) {
    // Origins differ between the preview and a deployment, so only the path of each href is pinned.
    const { pathname } = new URL(relation.href);
    const pattern = discoveryLinkPattern(relation.rel);
    const headLinks = head.match(pattern) ?? [];
    const documentLinks = html.match(pattern) ?? [];

    expect(link).toContain(`${pathname}>; rel="${relation.rel}"; type="${relation.type}"`);
    expect(headLinks).toHaveLength(1);
    expect(documentLinks).toHaveLength(1);
    expect(headLinks[0]).toMatch(
      new RegExp(`href="https?://[^"]+${escapeRegExp(pathname)}"`),
    );
    expect(headLinks[0]).toContain(`type="${relation.type}"`);
  }
});

// A failed HTML page has no Markdown twin: the advertised `.md` URL would fail the same way.
test("does not advertise a Markdown alternate on a missing docs page", async () => {
  const response = await fetchAppPath("/docs/no-such-page-exists");
  const link = response.headers.get("link") ?? "";

  expect(response.status).toBe(404);
  // next-intl stamps its own `rel="alternate"; hreflang=` values here, so pin the Markdown one.
  expect(link).not.toContain('type="text/markdown"');
  expect(link).toContain(`${LLMS_TXT_PATH}>; rel="describedby"`);
});

test("redirects an old docs .md path to its current .md URL", async () => {
  const response = await fetchAppPath("/docs/getting-started/setup.md", { redirect: "manual" });

  expect(response.status).toBe(301);
  const location = new URL(response.headers.get("location") ?? "", "http://localhost");
  expect(location.pathname).toBe(`${SEEDED_DOCS_ENTRY_PATH}.md`);
});

test("does not render a docs group as a markdown page", async () => {
  const response = await fetchAppPath(`/docs/${SEEDED_DOCS_ENTRY.categorySlug}.md`);

  expect(response.status).toBe(404);
});

test("serves llms.txt from the docs navigation tree", async () => {
  const response = await fetchAppPath(LLMS_TXT_PATH);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^text\/plain\b/);
  expect(response.headers.get("link")).toContain(`${LLMS_TXT_PATH}>; rel="describedby"`);

  const body = await response.text();
  expect(body.split("\n")[0]).toBe(`# ${SITE_NAME}`);
  expect(body).toMatch(/^## Documentation$/m);
  expect(body).toMatch(/^## Search API$/m);
  expect(body).toMatch(
    /^- \[Documentation search API\]\(https?:\/\/[^)]+\/api\/docs\/search\?q=authentication&limit=8\): /m,
  );
  expect(body).toMatch(
    new RegExp(`^- \\[Introduction\\]\\(https?://[^)]+${SEEDED_DOCS_ENTRY_PATH}\\.md\\): `, "m"),
  );
  expect(body).not.toMatch(/^### \[Introduction\]/m);
});

test("redirects the old docs llms.txt URL to the root file", async () => {
  const response = await fetchAppPath("/docs/llms.txt", { redirect: "manual" });

  expect(response.status).toBe(301);
  const location = new URL(response.headers.get("location") ?? "", "http://localhost");
  expect(location.pathname).toBe(LLMS_TXT_PATH);
});

// The two surfaces an agent can act on rather than only read. Origins differ between the preview
// and a deployment, so only the paths are asserted.
test("points agents at the OpenAPI document and the MCP endpoint from llms.txt", async () => {
  const response = await fetchAppPath(LLMS_TXT_PATH);
  const body = await response.text();

  expect(body).toMatch(/^## API and MCP$/m);
  expect(body).toMatch(
    new RegExp(`^- \\[OpenAPI document\\]\\(https?://[^)]+${API_OPENAPI_SPEC_PATH}\\): `, "m"),
  );
  expect(body).toMatch(
    new RegExp(`^- \\[MCP endpoint\\]\\(https?://[^)]+${MCP_PATH}\\): `, "m"),
  );
  expect(body).not.toContain("OpenAPI 3.1 document: `GET");
  expect(body).not.toContain("MCP endpoint (Streamable HTTP): `");
  expect(body).toContain(API_AUTH_DOCS_PATH);
  expect(body).toContain(`${API_AUTH_DOCS_PATH}.md`);
  expect(body).toContain(MCP_DOCS_PATH);
});

test("lists static Markdown pages before the documentation in llms.txt", async () => {
  const response = await fetchAppPath(LLMS_TXT_PATH);
  const body = await response.text();

  expect(body).toContain("/index.md");
  expect(body).toContain("/privacy.md");
  expect(body).toContain("/terms.md");
  expect(body.indexOf("## Site pages")).toBeLessThan(body.indexOf("## Documentation"));
});

// The frame heading must be the page `<h1>`, never the document `<title>`: the root layout template
// suffixes that title with the site name, so sourcing it there gave two H1 lines, one branded.
test("serves static docs and legal pages as markdown", async () => {
  const pages = [
    { mdPath: `${API_DOCS_PATH}.md`, heading: defaultMessages.Client.Docs.ApiReference.title },
    { mdPath: "/terms.md", heading: defaultMessages.Legal.Terms.title },
    { mdPath: "/privacy.md", heading: defaultMessages.Legal.Privacy.title },
    { mdPath: "/index.md", heading: defaultMessages.Landing.Hero.titleLine1 },
  ];

  for (const { mdPath, heading } of pages) {
    const response = await fetchAppPath(mdPath);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/markdown\b/);

    const body = await response.text();
    const topHeadings = body.split("\n").filter((line) => line.startsWith("# "));

    expect(topHeadings).toHaveLength(1);
    expect(topHeadings[0]).toContain(heading);
    expect(topHeadings[0].endsWith(` - ${SITE_NAME}`)).toBe(false);

    const source = body.split("\n").find((line) => line.startsWith("Source: "));
    expect(source).toBeDefined();
    expect(new URL(source!.slice("Source: ".length)).pathname).toBe(
      parseMarkdownPagePath(mdPath),
    );

    // Conversion invariants only. What the schema renders for a given field is unit-tested in
    // `src/lib/api/reference-model.test.ts` and `_components/api-schema-fields.test.ts`, so no
    // assertion here may name an endpoint, a field, or a scope this template happens to ship.
    if (mdPath === `${API_DOCS_PATH}.md`) {
      expect(body).toContain(
        defaultMessages.Client.Docs.ApiReference.agentGuidance.replace("{mcpPath}", MCP_PATH),
      );
      // `PROBLEM_JSON_CONTENT_TYPE` pulls in `cloudflare:workers` through the rate limiter, which
      // this plain-Node runner cannot resolve, so the media type is restated rather than imported.
      expect(body).toContain("application/problem+json");
      expect(body).not.toContain("[](#operation-");
    }

    if (mdPath === "/index.md") {
      // The hero `<h1>` spans two lines with a `<br>`; the frame heading joins them into one.
      expect(topHeadings[0]).toContain(defaultMessages.Landing.Hero.titleLine2);

      // The conversion contract, not the marketing copy of the day: a component that declares its
      // label as content with `data-markdown` keeps it, and a plain page action never appears.
      for (const question of faqQuestions(defaultMessages)) {
        expect(body).toContain(`### ${question}`);
      }

      expect(body).toContain(defaultMessages.Landing.Faq.isFree.answer.split("<link>")[0]);
      expect(body).not.toContain(defaultMessages.Client.Landing.Cta.copy);
      expect(body).not.toContain("<!--");
    }
  }
});

test("renders the agent platform docs pages that are app routes", async () => {
  const pages = [
    { pathname: API_AUTH_DOCS_PATH, heading: defaultMessages.Client.Docs.Auth.title },
    { pathname: MCP_DOCS_PATH, heading: defaultMessages.Client.Docs.Mcp.title },
    { pathname: API_ERRORS_DOCS_PATH, heading: defaultMessages.Client.Docs.ApiErrors.title },
  ];

  for (const { pathname, heading } of pages) {
    await loadAppFrame(pathname);

    await expectAppPathname(pathname);
    await expectAppRole("heading", heading, { exact: true });
  }
});

// The fork-extension guide lives in docs/extending-api-and-mcp.md in the repo, not as an app
// route: a public page would get indexed on every deployed fork.
test("does not serve the fork-extension guide as a public route", async () => {
  const response = await fetchAppPath("/docs/extending");

  expect(response.status).toBe(404);
});

test("serves docs search results from the public API endpoint", async () => {
  const response = await fetchAppPath("/api/docs/search?q=authentication&limit=3");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^application\/json\b/);

  const body = await response.json() as {
    results: Array<{
      title: string;
      resolvedPath: string;
      snippet: string;
    }>;
  };

  expect(body.results.length).toBeGreaterThan(0);
  expect(body.results.length).toBeLessThanOrEqual(3);
  expect(body.results[0]).toMatchObject({
    title: defaultMessages.Client.Docs.Auth.title,
    snippet: expect.stringMatching(/authentication/i),
  });
  expect(body.results.every((result) => result.title && result.resolvedPath && result.snippet)).toBe(true);

  const resolvedPath = new URL(body.results[0]?.resolvedPath ?? "");
  expect(resolvedPath.protocol).toMatch(/^https?:$/);
  expect(resolvedPath.pathname).toBe(API_AUTH_DOCS_PATH);
});

test("searches docs from the command dialog", async () => {
  await loadAppFrame(SEEDED_DOCS_ENTRY_PATH, { waitForHydration: true });

  await clickAppRole("button", "Search docs");
  await fillAppPlaceholder("Search docs...", "authentication");

  await expectAppText("Authentication Setup", { exact: true });
});

// The reference is rendered on the server from the app's own OpenAPI document — no spec-viewer
// bundle — so every expectation is read back out of that document rather than hard-coded.
async function readSpecOperations(): Promise<
  { operationId: string; path: string; summary: string }[]
> {
  const spec = await (await fetchAppPath(API_OPENAPI_SPEC_PATH)).json() as {
    paths: Record<string, Record<string, { operationId?: string; summary?: string }>>;
  };

  return Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.values(item)
      .filter((operation) => operation.operationId)
      .map((operation) => ({
        operationId: operation.operationId!,
        path,
        summary: operation.summary ?? "",
      })),
  );
}

/** The five entities React escapes text children with, so summaries can be compared as authored. */
function decodeHtmlText(html: string): string {
  return html
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

test("renders every documented operation into the API reference HTML", async () => {
  const operations = await readSpecOperations();
  expect(operations.length).toBeGreaterThan(0);

  const html = decodeHtmlText(await (await fetchAppPath(API_DOCS_PATH)).text());

  // Reported as one list so a regression names every operation that fell out of the HTML. The
  // anchor is the fragment the endpoint index and any external deep link point at.
  const missing = operations.filter(
    ({ operationId, path, summary }) =>
      !html.includes(`id="operation-${operationId}"`) ||
      !html.includes(path) ||
      !html.includes(summary),
  );

  expect(missing.map((operation) => operation.operationId)).toEqual([]);
});

test("filters the server-rendered endpoints client-side and reflects the query in the URL", async () => {
  const operations = await readSpecOperations();
  const [first] = operations;

  await loadAppFrame(API_DOCS_PATH, { waitForHydration: true });
  await expectAppText(first.summary);

  await fillAppPlaceholder(
    defaultMessages.Client.Docs.ApiReference.searchPlaceholder,
    "no-endpoint-matches-this",
  );

  await expectAppText(defaultMessages.Client.Docs.ApiReference.noResults);
  // Hidden, not removed: the operations stay in the document for crawlers and for a no-JS reader.
  await expectAppTextHidden(first.summary);
  expect(new URL(getAppCurrentUrl()).searchParams.get("q")).toBe("no-endpoint-matches-this");
});
