import "server-only";

import { BLOG_POSTS_PER_PAGE, SITE_URL } from "@/constants";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/translator";
import { getBlogCollectionPagePath, getBlogPagePath } from "@/lib/blog-routing";
import {
  getAuthorDisplayName,
  getAuthorRouteParam,
  type AuthorUrlIdentity,
} from "@/utils/blog-author-url";
import { getCmsEntryDates } from "@/utils/cms-entry-dates";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";
import {
  buildPageGraph,
  contentLocale,
  ORGANIZATION_SCHEMA_ID,
  pageSchemaId,
  schemaId,
  WEBSITE_SCHEMA_ID,
  type JsonLdNode,
} from "./json-ld";

const BLOG_PATHNAME = "/blog";
const BLOG_AUTHORS_PATHNAME = "/blog/authors";
const BLOG_TAGS_PATHNAME = "/blog/tags";

/** The author fields a graph needs. A CMS `createdByUser` row satisfies it as it stands. */
interface BlogAuthorInput extends AuthorUrlIdentity {
  avatar?: string | null;
}

/** The post fields a graph needs. A CMS blog entry satisfies it as it stands. */
interface BlogPostInput {
  slug: string;
  title: string;
  publishedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  featuredImageUrl?: string | null;
  createdByUser?: BlogAuthorInput | null;
}

/** The tag fields a graph needs, already localized by the caller. */
interface BlogTagInput {
  name: string;
  slug: string;
  description?: string | null;
}

function postPathname(slug: string): string {
  return `${BLOG_PATHNAME}/${slug}`;
}

function tagPathname(slug: string): string {
  return `${BLOG_TAGS_PATHNAME}/${slug}`;
}

function authorPathname(routeParam: string): string {
  return `${BLOG_AUTHORS_PATHNAME}/${routeParam}`;
}

/** CMS media paths are site-relative; structured data wants them absolute. */
function absoluteAssetUrl(path: string): string {
  return `${SITE_URL}${path}`;
}

interface BlogTranslators {
  blog: string;
  authors: string;
  tags: string;
  unknownAuthor: string;
}

// The labels every blog graph needs regardless of which page it is for.
async function getBlogLabels(locale: Locale): Promise<BlogTranslators> {
  const [tCrumb, tAuthors, tTags, tAuthorDetail] = await Promise.all([
    getTranslator({ locale, namespace: "Breadcrumb" }),
    getTranslator({ locale, namespace: "Blog.Authors" }),
    getTranslator({ locale, namespace: "Blog.Tags" }),
    getTranslator({ locale, namespace: "Blog.AuthorDetail" }),
  ]);

  return {
    blog: tCrumb("blog"),
    authors: tAuthors("title"),
    tags: tTags("title"),
    unknownAuthor: tAuthorDetail("unknownAuthor"),
  };
}

interface ResolvedEntity {
  id: string;
  url: string;
  node: JsonLdNode;
}

function authorPerson({
  author,
  locale,
  unknownAuthor,
}: {
  author: BlogAuthorInput;
  locale: Locale;
  unknownAuthor: string;
}): ResolvedEntity & { name: string } {
  const pathname = authorPathname(getAuthorRouteParam(author));
  const url = absoluteLocalizedUrl({ pathname, locale });
  // The same `@id` the author's own profile page publishes, so one writer resolves as one entity
  // across every post instead of a fresh anonymous person per article.
  const id = schemaId({ kind: "person", pathname, locale });
  const name = getAuthorDisplayName(author, unknownAuthor);

  return {
    id,
    url,
    name,
    node: {
      "@type": "Person",
      "@id": id,
      name,
      url,
      ...(author.avatar && { image: absoluteAssetUrl(author.avatar) }),
    },
  };
}

function tagTerm({ tag, locale }: { tag: BlogTagInput; locale: Locale }): ResolvedEntity {
  const pathname = tagPathname(tag.slug);
  const url = absoluteLocalizedUrl({ pathname, locale });
  const id = schemaId({ kind: "term", pathname, locale });

  return {
    id,
    url,
    node: {
      "@type": "DefinedTerm",
      "@id": id,
      name: tag.name,
      url,
      ...(tag.description && { description: tag.description }),
    },
  };
}

// The listing shape of one post: enough for a crawler to recognise it, bound by `@id` to the node
// the post's own page publishes so the two merge instead of competing.
function postSummaryNode({
  post,
  locale,
  unknownAuthor,
}: {
  post: BlogPostInput;
  locale: Locale;
  unknownAuthor: string;
}): ResolvedEntity {
  const pathname = postPathname(post.slug);
  const url = absoluteLocalizedUrl({ pathname, locale });
  const id = schemaId({ kind: "article", pathname, locale });
  const { publishedDate, modifiedDate } = getCmsEntryDates(post);

  return {
    id,
    url,
    node: {
      "@type": "BlogPosting",
      "@id": id,
      url,
      headline: post.title,
      datePublished: publishedDate.toISOString(),
      dateModified: modifiedDate.toISOString(),
      ...(post.featuredImageUrl && { image: absoluteAssetUrl(post.featuredImageUrl) }),
      ...(post.createdByUser && {
        author: authorPerson({ author: post.createdByUser, locale, unknownAuthor }).node,
      }),
    },
  };
}

interface BlogPostGraphOptions {
  /** The active locale, from the route param. */
  locale: Locale;
  /** True when this post is untranslated and its default-locale body renders under `locale`. */
  isFallback: boolean;
  post: BlogPostInput;
  description: string;
  /** The post's tags, localized to the body's real language. */
  tags: readonly BlogTagInput[];
}

/**
 * Ids are minted from the resolved content locale, so a fallback render and its listings mean one article.
 */
export async function buildBlogPostGraph({
  locale,
  isFallback,
  post,
  description,
  tags,
}: BlogPostGraphOptions) {
  const displayLocale = contentLocale({ locale, isFallback });
  const labels = await getBlogLabels(displayLocale);
  const pathname = postPathname(post.slug);
  const url = absoluteLocalizedUrl({ pathname, locale: displayLocale });
  const articleId = schemaId({ kind: "article", pathname, locale: displayLocale });
  const { publishedDate, modifiedDate } = getCmsEntryDates(post);
  const terms = tags.map((tag) => tagTerm({ tag, locale: displayLocale }));

  const blogPosting: JsonLdNode = {
    "@type": "BlogPosting",
    "@id": articleId,
    headline: post.title,
    // A fallback render serves the default-locale body under a non-default prefix, so advertise
    // the body's real language, not the URL's.
    inLanguage: displayLocale,
    description,
    url,
    datePublished: publishedDate.toISOString(),
    dateModified: modifiedDate.toISOString(),
    // Binds the article to the page and the site, so a crawler resolves one entity per URL
    // instead of an anonymous article floating beside an anonymous page.
    mainEntityOfPage: { "@id": pageSchemaId(url) },
    isPartOf: { "@id": WEBSITE_SCHEMA_ID },
    publisher: { "@id": ORGANIZATION_SCHEMA_ID },
    ...(post.featuredImageUrl && { image: absoluteAssetUrl(post.featuredImageUrl) }),
    ...(post.createdByUser && {
      author: authorPerson({
        author: post.createdByUser,
        locale: displayLocale,
        unknownAuthor: labels.unknownAuthor,
      }).node,
    }),
    ...(terms.length > 0 && {
      keywords: tags.map((tag) => tag.name).join(", "),
      // Points at the same terms the tag pages define, so the subject of a post is the entity a
      // reader can browse rather than an anonymous label.
      about: terms.map((term) => ({ "@id": term.id })),
    }),
  };

  return buildPageGraph({
    locale: displayLocale,
    pathname,
    name: post.title,
    description,
    datePublished: publishedDate,
    dateModified: modifiedDate,
    ...(post.featuredImageUrl && { primaryImageUrl: absoluteAssetUrl(post.featuredImageUrl) }),
    trail: [{ pathname: BLOG_PATHNAME, name: labels.blog }],
    mainEntity: { "@id": articleId },
    nodes: [blogPosting, ...terms.map((term) => term.node)],
  });
}

interface BlogListGraphOptions {
  locale: Locale;
  /** 1-based page of the paginated listing. */
  page: number;
  posts: readonly BlogPostInput[];
}

/** The graph the paginated blog index emits: a `Blog` of its posts, plus their reading order. */
export async function buildBlogListGraph({ locale, page, posts }: BlogListGraphOptions) {
  const [t, labels] = await Promise.all([
    getTranslator({ locale, namespace: "Blog.ListPage.meta" }),
    getBlogLabels(locale),
  ]);
  const pathname = getBlogPagePath({ page });
  const blogId = schemaId({ kind: "blog", pathname, locale });
  const itemListId = schemaId({ kind: "itemList", pathname, locale });

  // One pass, two projections. `Blog.blogPost` describes each post and `ItemList` orders them;
  // mapping the same array twice is exactly how the two used to drift apart.
  const entries = posts.map((post, index) => {
    const summary = postSummaryNode({ post, locale, unknownAuthor: labels.unknownAuthor });
    const listItem: JsonLdNode = {
      "@type": "ListItem",
      // Collection-global, unlike `numberOfItems` below: it is what says this is page N of a series.
      position: (page - 1) * BLOG_POSTS_PER_PAGE + index + 1,
      url: summary.url,
      name: post.title,
    };

    return { post: summary.node, listItem };
  });

  const blog: JsonLdNode = {
    "@type": "Blog",
    "@id": blogId,
    name: t("title"),
    inLanguage: locale,
    description: t("description"),
    publisher: { "@id": ORGANIZATION_SCHEMA_ID },
    ...(entries.length > 0 && { blogPost: entries.map((entry) => entry.post) }),
  };

  // Reading order, which `Blog.blogPost` does not convey.
  const itemList: JsonLdNode = {
    "@type": "ItemList",
    "@id": itemListId,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    // Page-local, unlike `position` above.
    numberOfItems: entries.length,
    itemListElement: entries.map((entry) => entry.listItem),
  };

  return buildPageGraph({
    locale,
    pathname,
    name: page === 1 ? t("title") : t("titleWithPage", { page }),
    description: t("description"),
    pageTypes: ["CollectionPage"],
    // Both, when there is a list: the page is the blog, and it is this ordered slice of it.
    mainEntity:
      entries.length > 0 ? [{ "@id": blogId }, { "@id": itemListId }] : { "@id": blogId },
    nodes: entries.length > 0 ? [blog, itemList] : [blog],
  });
}

/**
 * `ProfilePage` is Google's type for a page about one person; `mainEntity` names them. No `email`.
 */
export async function buildBlogAuthorGraph({
  locale,
  author,
  page = 1,
}: {
  locale: Locale;
  author: BlogAuthorInput;
  page?: number;
}) {
  const [tDetail, labels] = await Promise.all([
    getTranslator({ locale, namespace: "Blog.AuthorDetail" }),
    getBlogLabels(locale),
  ]);
  const person = authorPerson({ author, locale, unknownAuthor: labels.unknownAuthor });

  return buildPageGraph({
    locale,
    pathname: getBlogCollectionPagePath({ pathname: authorPathname(getAuthorRouteParam(author)), page }),
    name: person.name,
    description: tDetail("meta.description", { name: person.name }),
    pageTypes: ["ProfilePage"],
    trail: [
      { pathname: BLOG_PATHNAME, name: labels.blog },
      { pathname: BLOG_AUTHORS_PATHNAME, name: labels.authors },
    ],
    ...(author.avatar && { primaryImageUrl: absoluteAssetUrl(author.avatar) }),
    mainEntity: { "@id": person.id },
    nodes: [{ ...person.node, worksFor: { "@id": ORGANIZATION_SCHEMA_ID } }],
  });
}

/** The graph the authors index emits: an ordered list of the people who write the blog. */
export async function buildBlogAuthorsGraph({
  locale,
  authors,
}: {
  locale: Locale;
  authors: readonly BlogAuthorInput[];
}) {
  const [t, labels] = await Promise.all([
    getTranslator({ locale, namespace: "Blog.Authors" }),
    getBlogLabels(locale),
  ]);

  return buildPageGraph({
    locale,
    pathname: BLOG_AUTHORS_PATHNAME,
    name: t("meta.title"),
    description: t("description"),
    pageTypes: ["CollectionPage"],
    trail: [{ pathname: BLOG_PATHNAME, name: labels.blog }],
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: authors.length,
      // No `email`: structured data is the easiest thing on the page for a harvester to read, and
      // an author's address is not what the listing is for.
      itemListElement: authors.map((author, index) => {
        const person = authorPerson({ author, locale, unknownAuthor: labels.unknownAuthor });

        return {
          "@type": "ListItem",
          position: index + 1,
          url: person.url,
          item: person.node,
        };
      }),
    },
  });
}

/** The graph one tag's page emits: the term itself, and the posts it collects. */
export async function buildBlogTagGraph({
  locale,
  tag,
  posts,
  page = 1,
}: {
  locale: Locale;
  tag: BlogTagInput;
  posts: readonly BlogPostInput[];
  page?: number;
}) {
  const [t, labels] = await Promise.all([
    getTranslator({ locale, namespace: "Blog.TagDetail.meta" }),
    getBlogLabels(locale),
  ]);
  const term = tagTerm({ tag, locale });

  return buildPageGraph({
    locale,
    pathname: getBlogCollectionPagePath({ pathname: tagPathname(tag.slug), page }),
    name: t("title", { name: tag.name }),
    description: tag.description || t("description", { name: tag.name }),
    pageTypes: ["CollectionPage"],
    trail: [
      { pathname: BLOG_PATHNAME, name: labels.blog },
      { pathname: BLOG_TAGS_PATHNAME, name: labels.tags },
    ],
    // The tag itself is what the page is about; the post list is what it collects.
    about: { "@id": term.id },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: posts.length,
      itemListElement: posts.map((post, index) => {
        const summary = postSummaryNode({ post, locale, unknownAuthor: labels.unknownAuthor });

        return {
          "@type": "ListItem",
          position: (page - 1) * BLOG_POSTS_PER_PAGE + index + 1,
          url: summary.url,
          item: summary.node,
        };
      }),
    },
    nodes: [term.node],
  });
}

/** The graph the tags index emits: an ordered list of every topic the blog covers. */
export async function buildBlogTagsGraph({
  locale,
  tags,
}: {
  locale: Locale;
  tags: readonly BlogTagInput[];
}) {
  const [t, labels] = await Promise.all([
    getTranslator({ locale, namespace: "Blog.Tags.meta" }),
    getBlogLabels(locale),
  ]);

  return buildPageGraph({
    locale,
    pathname: BLOG_TAGS_PATHNAME,
    name: t("title"),
    description: t("description"),
    pageTypes: ["CollectionPage"],
    trail: [{ pathname: BLOG_PATHNAME, name: labels.blog }],
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: tags.length,
      itemListElement: tags.map((tag, index) => {
        const term = tagTerm({ tag, locale });

        // `url` on the ListItem as well, so the term is reachable rather than a bare label.
        return {
          "@type": "ListItem",
          position: index + 1,
          url: term.url,
          item: term.node,
        };
      }),
    },
  });
}
