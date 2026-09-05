import { describe, expect, test, vi } from "vitest";

import { SITE_URL } from "@/constants";
import { DEFAULT_LOCALE, ENABLED_LOCALES, type Locale } from "@/i18n/config";
import { getCmsNavigationConfig } from "@/lib/cms/cms-navigation-config";
import { DOCS_SLUG } from "@/lib/cms/docs-config";

vi.mock("server-only", () => ({}));

const { buildPageGraph, buildSiteJsonLd, serializeJsonLd, SiteJsonLd } = await import("./json-ld");
const {
  buildBlogAuthorGraph,
  buildBlogAuthorsGraph,
  buildBlogListGraph,
  buildBlogPostGraph,
  buildBlogTagGraph,
  buildBlogTagsGraph,
} = await import("./blog-json-ld");
const { buildDocsArticleGraph, buildDocsCollectionGraph } = await import("./docs-json-ld");
const { buildFaqQuestions } = await import("./faq-json-ld");

type Node = Record<string, unknown> & { "@id"?: string };
interface Graph {
  "@context": string;
  "@graph": readonly Node[];
}

const SCHEMA_CONTEXT = "https://schema.org";
const PAGE_ROOT = "WebPage";
const SITE_ROOT = "WebSite";

// Routes, branding, and the served locale set are all template-configurable, so fixtures and
// expectations derive from the constants rather than the shipped values.
const LOCALE = DEFAULT_LOCALE;
const NON_DEFAULT_LOCALE = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);
const DOCS_BASE_PATH = getCmsNavigationConfig(DOCS_SLUG).basePath;
const DOCS_SECTION = { pathname: `${DOCS_BASE_PATH}/guides`, name: "Guides" };
const DOCS_ITEM = { pathname: `${DOCS_SECTION.pathname}/setup`, name: "Setup", description: "Set up." };

const DATE = new Date("2026-01-01T00:00:00.000Z");
const TAG = { name: "React", slug: "react", description: "Posts about React." };
const AUTHOR = {
  id: "user_1",
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  avatar: "/media/ada.png",
};

function makePost(slug: string) {
  return {
    slug,
    title: `Post ${slug}`,
    publishedAt: DATE,
    createdAt: DATE,
    updatedAt: DATE,
    featuredImageUrl: "/media/cover.png",
    createdByUser: AUTHOR,
  };
}

function blogPost({ locale = LOCALE, isFallback = false }: { locale?: Locale; isFallback?: boolean } = {}) {
  return buildBlogPostGraph({ locale, isFallback, post: makePost("hello"), description: "A post.", tags: [TAG] });
}

function docsCollection(items: readonly (typeof DOCS_ITEM)[]) {
  return buildDocsCollectionGraph({ locale: LOCALE, ...DOCS_SECTION, description: "The guides.", items });
}

interface GraphFixture {
  name: string;
  /** The node the whole graph hangs off; every other node must be reachable from it. */
  root: string;
  build: () => Promise<Graph>;
}

function pageGraph(name: string, build: () => Promise<Graph>): GraphFixture {
  return { name, root: PAGE_ROOT, build };
}

// Every graph the site can emit. A new builder is a new row here, not a new describe block: the
// invariants below are what the markup has to satisfy whatever page it describes.
const GRAPHS: readonly GraphFixture[] = [
  { name: "site", root: SITE_ROOT, build: () => buildSiteJsonLd() },
  pageGraph("generic page", () => buildPageGraph({ locale: LOCALE, pathname: "/privacy", name: "Privacy" })),
  pageGraph("landing FAQ", async () => buildPageGraph({
    locale: LOCALE, pathname: "/", name: "Home",
    pageTypes: ["FAQPage"], mainEntity: await buildFaqQuestions(LOCALE),
  })),
  pageGraph("blog post", () => blogPost()),
  pageGraph("blog list", () => buildBlogListGraph({ locale: LOCALE, page: 1, posts: [makePost("hello")] })),
  pageGraph("blog list without posts", () => buildBlogListGraph({ locale: LOCALE, page: 2, posts: [] })),
  pageGraph("blog author", () => buildBlogAuthorGraph({ locale: LOCALE, author: AUTHOR })),
  pageGraph("blog authors index", () => buildBlogAuthorsGraph({ locale: LOCALE, authors: [AUTHOR] })),
  pageGraph("blog tag", () => buildBlogTagGraph({ locale: LOCALE, tag: TAG, posts: [makePost("hello")] })),
  pageGraph("blog tags index", () => buildBlogTagsGraph({ locale: LOCALE, tags: [TAG] })),
  pageGraph("docs article", () => buildDocsArticleGraph({
    locale: LOCALE, ...DOCS_ITEM, trail: [DOCS_SECTION],
    sections: ["Install", "Deploy"], markdownUrl: `${SITE_URL}/markdown${DOCS_ITEM.pathname}.md`,
  })),
  pageGraph("docs collection", () => docsCollection([DOCS_ITEM])),
  pageGraph("docs collection without pages", () => docsCollection([])),
  // A fallback render serves the default-locale body under another prefix; a translation is its
  // own article. Both are rows so the identity pairs below can name them.
  ...(NON_DEFAULT_LOCALE
    ? [
        pageGraph("blog post as fallback", () => blogPost({ locale: NON_DEFAULT_LOCALE, isFallback: true })),
        pageGraph("blog post translated", () => blogPost({ locale: NON_DEFAULT_LOCALE })),
      ]
    : []),
];

/** Every plain object in a graph. An inline `Person` is as much a node as a top-level one. */
function walk(value: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  visit(value as Node);
  Object.values(value).forEach((item) => walk(item, visit));
}

// A bare `{"@id": ...}` is a pointer; anything with more keys is a definition.
function collect(value: unknown): { references: string[]; definitions: Node[] } {
  const references: string[] = [];
  const definitions: Node[] = [];
  walk(value, (node) => {
    const keys = Object.keys(node);
    if (keys.length === 1 && keys[0] === "@id") {
      references.push(node["@id"]!);
      return;
    }
    definitions.push(node);
  });

  return { references, definitions };
}

function hasType(node: Node, type: string): boolean {
  const nodeType = node["@type"];

  return Array.isArray(nodeType) ? nodeType.includes(type) : nodeType === type;
}

function nodesOfType(value: unknown, type: string): Node[] {
  return collect(value).definitions.filter((node) => hasType(node, type));
}

// The ids `RootShell` publishes on every page, which a page graph may point at without defining.
const SITE_IDS = new Set(
  (await buildSiteJsonLd())["@graph"].map((node) => node["@id"] as string),
);

// Each fixture is built once; every invariant reads the same graph.
const built = new Map<string, Promise<Graph>>();
function graphFor(fixture: GraphFixture): Promise<Graph> {
  const graph = built.get(fixture.name) ?? fixture.build();
  built.set(fixture.name, graph);

  return graph;
}

describe.each(GRAPHS)("$name graph", (fixture) => {
  test("types every node it defines and gives it an absolute, unique @id", async () => {
    const graph = await graphFor(fixture);
    const { definitions } = collect(graph["@graph"]);
    const topLevel = graph["@graph"].map((node) => node["@id"]);
    // A nested definition repeats by design — one author across a listing — so only its form is checked.
    const ids = definitions.map((node) => node["@id"]).filter(Boolean);

    expect(graph["@context"]).toBe(SCHEMA_CONTEXT);
    expect(topLevel.length).toBeGreaterThan(0);
    expect(definitions.filter((node) => !node["@type"])).toEqual([]);
    expect(ids.filter((id) => !id!.startsWith(SITE_URL))).toEqual([]);
    expect(topLevel.filter((id) => !id)).toEqual([]);
    expect(new Set(topLevel).size).toBe(topLevel.length);
  });

  // A pointer to an `@id` no node defines is the failure mode `@id` linking exists to avoid: the
  // crawler drops the edge silently and the entities stop resolving as one.
  test("points at no id it leaves undefined", async () => {
    const graph = await graphFor(fixture);
    const { references, definitions } = collect(graph["@graph"]);
    const defined = new Set(definitions.map((node) => node["@id"]).filter(Boolean));

    expect(references.filter((id) => !defined.has(id) && !SITE_IDS.has(id))).toEqual([]);
  });

  // An unreachable node is bytes with no graph meaning: nothing links it to this URL, so a crawler
  // has no reason to attach it.
  test("leaves no node unreachable from its root", async () => {
    const { "@graph": nodes } = await graphFor(fixture);
    const byId = new Map(nodes.map((node) => [node["@id"], node]));
    const seen = new Set<Node>();
    const follow = (node: Node | undefined) => {
      if (!node || seen.has(node)) {
        return;
      }
      seen.add(node);
      collect(node).references.forEach((id) => follow(byId.get(id)));
    };

    follow(nodes.find((node) => hasType(node, fixture.root)));

    expect(nodes.filter((node) => !seen.has(node))).toEqual([]);
  });

  // The bug this guards: two builders disagreeing on whether a shared trail already holds a
  // section root, so the crumb it owns is emitted twice.
  test.runIf(fixture.root === PAGE_ROOT)("walks one unique path down to the page", async () => {
    const graph = await graphFor(fixture);
    const [breadcrumb] = nodesOfType(graph["@graph"], "BreadcrumbList");
    const items = breadcrumb!.itemListElement as Array<{ position: number; item: string }>;
    const urls = items.map((item) => item.item);

    expect(items.map((item) => item.position)).toEqual(items.map((_, index) => index + 1));
    expect(new Set(urls).size).toBe(urls.length);
    urls.slice(1).forEach((url, index) => expect(url.startsWith(urls[index]!)).toBe(true));
    expect(urls.at(-1)).toBe(nodesOfType(graph["@graph"], PAGE_ROOT)[0]?.url);
  });

  // Every page publishes these nodes under the same `@id`, so a value that varied by request
  // locale would leave the merged entity depending on which URL a crawler reached first.
  test.runIf(fixture.root === SITE_ROOT)("names every served locale, not the request's", async () => {
    const graph = await graphFor(fixture);
    const [website] = nodesOfType(graph["@graph"], SITE_ROOT);

    expect(website!.inLanguage).toEqual(ENABLED_LOCALES);
  });

  test("round-trips through serialization", async () => {
    const graph = await graphFor(fixture);

    expect(JSON.parse(serializeJsonLd(graph))).toEqual(graph);
  });
});

interface IdentityPair {
  label: string;
  /** The type whose first occurrence in each graph is the entity under test. */
  type: string;
  /** Fixture names from `GRAPHS`. */
  a: string;
  b: string;
  /** False when the two renders are genuinely different entities and must not merge. */
  same?: boolean;
}

// Two pages that mention one entity have to agree on its `@id` character for character, or a
// crawler sees two entities. The fallback rows are the regression guard for a shipped defect: a
// fallback render canonicalizes to the default locale, and so must the ids it mints.
const IDENTITY_PAIRS: readonly IdentityPair[] = [
  { label: "a post and the listing that links it", type: "BlogPosting", a: "blog post", b: "blog list" },
  { label: "a post and its author's profile", type: "Person", a: "blog post", b: "blog author" },
  { label: "a profile and the authors index", type: "Person", a: "blog author", b: "blog authors index" },
  { label: "a post and its tag's page", type: "DefinedTerm", a: "blog post", b: "blog tag" },
  { label: "a tag's page and the tags index", type: "DefinedTerm", a: "blog tag", b: "blog tags index" },
  ...(NON_DEFAULT_LOCALE
    ? ([
        { label: "a fallback render and the listing", type: "BlogPosting", a: "blog post as fallback", b: "blog list" },
        { label: "a translated render and the listing", type: "BlogPosting", a: "blog post translated", b: "blog list", same: false },
      ] satisfies IdentityPair[])
    : []),
];

function graphNamed(name: string): Promise<Graph> {
  const fixture = GRAPHS.find((row) => row.name === name);
  if (!fixture) {
    throw new Error(`No graph fixture named "${name}"`);
  }

  return graphFor(fixture);
}

describe("entity identity across pages", () => {
  test.each(IDENTITY_PAIRS)("$label", async ({ type, a, b, same = true }) => {
    const [first, second] = await Promise.all([graphNamed(a), graphNamed(b)]);
    const idA = nodesOfType(first["@graph"], type)[0]?.["@id"];
    const idB = nodesOfType(second["@graph"], type)[0]?.["@id"];

    expect(idA).toBeDefined();
    expect(idB).toBeDefined();
    if (same) {
      expect(idA).toBe(idB);
      return;
    }
    expect(idA).not.toBe(idB);
  });
});

// CMS-authored titles reach these payloads, so a closing tag in one must not end the script.
test("serialization cannot close the surrounding script tag", async () => {
  const name = "</script><script>alert(1)</script>";
  const graph = await buildPageGraph({ locale: LOCALE, pathname: "/privacy", name });
  const serialized = serializeJsonLd(graph);

  expect(serialized).not.toContain("</script>");
  expect(JSON.parse(serialized)).toEqual(graph);
});

test("reuses fixed site data and emits the same safe bytes on later requests", async () => {
  const first = await buildSiteJsonLd();
  expect(await buildSiteJsonLd()).toBe(first);
  const element = await SiteJsonLd();
  expect(element.props.dangerouslySetInnerHTML.__html).toBe(serializeJsonLd(first));
  expect((await SiteJsonLd()).props.dangerouslySetInnerHTML.__html).toBe(element.props.dangerouslySetInnerHTML.__html);
});
