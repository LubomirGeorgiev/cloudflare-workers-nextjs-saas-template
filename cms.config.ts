import {
  type DefineCmsCollection,
  type DefineCmsConfig
} from "@/lib/cms/cms-models";
import z from "zod";

const blogCollection = {
  slug: "blog",
  labels: {
    singular: "Blog",
    plural: "Blogs",
  },
  previewUrl: "/blog/{slug}",
} satisfies DefineCmsCollection;

export const cmsConfig = {
  collections: {
    blog: blogCollection,
  },
} satisfies DefineCmsConfig;

export type CollectionsUnion = keyof typeof cmsConfig.collections;

export const collectionSlugs = Object.keys(cmsConfig.collections)
export const zodCollectionEnum = z.enum(collectionSlugs as [CollectionsUnion, ...CollectionsUnion[]])
