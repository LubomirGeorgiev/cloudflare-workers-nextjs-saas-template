import { z } from "zod";

export const docsSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().positive().max(20).optional().default(8),
});

// oxlint-disable-next-line project/no-unused-module-exports -- Schemas intentionally export validation contracts and inferred types together.
export type DocsSearchQuery = z.infer<typeof docsSearchQuerySchema>;
