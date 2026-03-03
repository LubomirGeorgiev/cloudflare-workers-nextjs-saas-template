import type { z } from "zod";

export type DefineCmsCollection<TFieldsSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  slug: string;
  labels: {
    singular: string;
    plural: string;
  };
  fieldsSchema?: TFieldsSchema;
  previewUrl?: (slug: string) => string;
  includeInSitemap?: boolean;
};

export type DefineCmsConfig = {
  collections: Record<string, DefineCmsCollection>;
};
