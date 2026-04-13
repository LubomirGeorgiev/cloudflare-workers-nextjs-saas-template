import { z } from "zod";

export const docsSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().positive().max(20).optional().default(8),
});

export type DocsSearchQuery = z.infer<typeof docsSearchQuerySchema>;
