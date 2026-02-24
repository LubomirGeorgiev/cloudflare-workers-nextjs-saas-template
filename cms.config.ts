import {
  type DefineCmsCollection,
  type DefineCmsConfig
} from "@/lib/cms/cms-models";
import z from "zod";

const blogFieldsSchema = z.object({
  excerpt: z.string().max(200).optional(),
});

export type BlogFields = z.infer<typeof blogFieldsSchema>;

/**
 * ***************************************************************************************
 *
 * When you add a new collection don't forget to also add it to the sitemap.ts file !!!
 *
 * ***************************************************************************************
 */
const blogCollection = {
  slug: "blog",
  labels: {
    singular: "Blog",
    plural: "Blogs",
  },
  fieldsSchema: blogFieldsSchema,
  previewUrl: (slug: string) => `/blog/${slug}`,
} satisfies DefineCmsCollection<typeof blogFieldsSchema>;

export const cmsConfig = {
  collections: {
    blog: blogCollection,
  },
} satisfies DefineCmsConfig;

export type CollectionsUnion = keyof typeof cmsConfig.collections;

export const collectionSlugs = Object.keys(cmsConfig.collections) as [CollectionsUnion, ...CollectionsUnion[]];
export const zodCollectionEnum = z.enum(collectionSlugs);
