import {
  type DefineCmsCollection,
  type DefineCmsNavigationSite,
  type DefineCmsConfig
} from "@/lib/cms/cms-models";
import {
  DOCS_BASE_PATH,
  DOCS_SLUG,
} from "@/lib/cms/docs-config";
import z from "zod";

const blogFieldsSchema = z.object({
  excerpt: z.string().max(200).optional(),
});

export type BlogFields = z.infer<typeof blogFieldsSchema>;

const blogCollection = {
  slug: "blog",
  labels: {
    singular: "Blog",
    plural: "Blogs",
  },
  description:
    "Articles and updates from the team: product news, engineering notes, and guides published on the marketing site.",
  fieldsSchema: blogFieldsSchema,
  previewUrl: (slug: string) => `/blog/${slug}`,
  includeInSitemap: true,
} satisfies DefineCmsCollection<typeof blogFieldsSchema>;

const docsCollection = {
  slug: DOCS_SLUG,
  labels: {
    singular: "Doc",
    plural: "Docs",
  },
  description:
    "Product documentation for this application: how it works, how to run and deploy it, and how to use its features.",
  navigationKey: DOCS_SLUG,
  includeInSitemap: true,
  enableSearch: true,
} satisfies DefineCmsCollection;

const docsNavigation = {
  label: "Docs Navigation",
  description: "Manage the docs sidebar structure and canonical public URLs",
  collectionSlug: DOCS_SLUG,
  basePath: DOCS_BASE_PATH,
} satisfies DefineCmsNavigationSite;

export const cmsConfig = {
  collections: {
    blog: blogCollection,
    docs: docsCollection,
  },
  navigations: {
    [DOCS_SLUG]: docsNavigation,
  },
} satisfies DefineCmsConfig;

export type CollectionsUnion = keyof typeof cmsConfig.collections;
export type CmsNavigationKey = keyof typeof cmsConfig.navigations;

export const collectionSlugs = Object.keys(cmsConfig.collections) as [CollectionsUnion, ...CollectionsUnion[]];
export const zodCollectionEnum = z.enum(collectionSlugs);
export const cmsNavigationKeys = Object.keys(cmsConfig.navigations) as [
  CmsNavigationKey,
  ...CmsNavigationKey[],
];
