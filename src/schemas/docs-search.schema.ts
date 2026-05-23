import { coerceNumber, requiredString, v } from "@/lib/validation";

export const docsSearchQuerySchema = v.object({
  q: v.pipe(requiredString(), v.trim(), v.maxLength(100)),
  limit: v.optional(v.pipe(coerceNumber(), v.integer(), v.minValue(1), v.maxValue(20)), 8),
});

// oxlint-disable-next-line project/no-unused-module-exports -- Schemas intentionally export validation contracts and inferred types together.
export type DocsSearchQuery = v.InferOutput<typeof docsSearchQuerySchema>;
