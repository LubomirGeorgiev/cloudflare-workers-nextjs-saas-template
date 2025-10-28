"use server";

import {
  type DefineCmsCollection,
  type DefineCmsConfig
} from "@/lib/cms/cms-models";

const blogCollection = {
  slug: "blog",
  labels: {
    singular: "Blog",
    plural: "Blogs",
  },
} satisfies DefineCmsCollection;

export const cmsConfig = {
  collections: {
    blog: blogCollection,
  },
} satisfies DefineCmsConfig;
