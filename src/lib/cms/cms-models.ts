import type { z } from "zod";

export type DefineCmsCollection<TFieldsSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  slug: string;
  labels: {
    singular: string;
    plural: string;
  };
  description?: string;
  fieldsSchema?: TFieldsSchema;
  previewUrl?: (slug: string) => string;
  includeInSitemap?: boolean;
  navigationKey?: string;
  enableSearch?: boolean;
};

export type DefineCmsNavigationSite = {
  label: string;
  collectionSlug: string;
  basePath: string;
  description?: string;
};

export type DefineCmsConfig = {
  collections: Record<string, DefineCmsCollection>;
  navigations: Record<string, DefineCmsNavigationSite>;
};
