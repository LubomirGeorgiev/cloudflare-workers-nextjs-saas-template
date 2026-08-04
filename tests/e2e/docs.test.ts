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
  MCP_DOCS_PATH,
  MCP_PATH,
  SITE_NAME,
} from "../../src/constants";
import { DEFAULT_LOCALE } from "../../src/i18n/config";
import { loadCatalog } from "../../src/i18n/message-catalogs";
import { SEEDED_DOCS_ENTRY, SEEDED_DOCS_ENTRY_PATH } from "./seed-fixtures";

const defaultMessages = await loadCatalog(DEFAULT_LOCALE);

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

test("serves docs markdown exports for AI and download workflows", async () => {
  const response = await fetchAppPath(`/markdown/docs/${SEEDED_DOCS_ENTRY.slug}`);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^text\/markdown\b/);

  const body = await response.text();
  expect(body).toMatch(/^# Introduction/m);
  expect(body).toContain("Authentication and team management");
});

// Guards the proxy matcher: a dotted pathname must still reach the docs page so
// its `.md` suffix resolves, rather than being excluded as a static asset.
test("redirects a docs page requested with a .md suffix to its markdown export", async () => {
  const response = await fetchAppPath(`${SEEDED_DOCS_ENTRY_PATH}.md`, { redirect: "manual" });

  expect(response.status).toBe(307);
  // Base only resolves a possibly-relative Location header; it is never asserted on.
  const location = new URL(response.headers.get("location") ?? "", "http://localhost");
  expect(location.pathname).toBe(`/markdown/docs/${SEEDED_DOCS_ENTRY.slug}`);
});

test("serves llms.txt from the docs navigation tree", async () => {
  const response = await fetchAppPath("/docs/llms.txt");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^text\/plain\b/);

  const body = await response.text();
  expect(body.split("\n")[0]).toBe(`# ${SITE_NAME}`);
  expect(body).toMatch(/^## Documentation$/m);
  expect(body).toMatch(/^## Search API$/m);
  expect(body).toMatch(/GET https?:\/\/\S+\/api\/docs\/search\?q=authentication&limit=8/);
  expect(body).toMatch(/^- \[Introduction\]\(https?:\/\/[^)]+\/markdown\/docs\/introduction\): /m);
});

// The two surfaces an agent can act on rather than only read. Origins differ between the preview
// and a deployment, so only the paths are asserted.
test("points agents at the OpenAPI document and the MCP endpoint from llms.txt", async () => {
  const response = await fetchAppPath("/docs/llms.txt");
  const body = await response.text();

  expect(body).toMatch(/^## API and MCP$/m);
  expect(body).toContain(API_OPENAPI_SPEC_PATH);
  expect(body).toMatch(new RegExp(`https?://[^\\s\`]+${MCP_PATH}\``));
  expect(body).toContain(API_AUTH_DOCS_PATH);
  expect(body).toContain(MCP_DOCS_PATH);
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
