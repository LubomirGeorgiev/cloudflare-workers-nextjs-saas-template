import { collectionSchema } from "@/../cms.config";
import { v } from "@/lib/validation";

// Only the two search actions read a collection. A variant, not one flat object, so
// `{ type: "purge-workers-cdn-cache", collection: "blog" }` is refused instead of silently dropped.
const COLLECTION_ACTION_TYPES = ["rebuild-search-index", "clear-search-cache"] as const;
const GLOBAL_ACTION_TYPES = [
  "clear-cms-cache",
  "purge-vinext-kv-cache",
  "purge-workers-cdn-cache",
] as const;

// Strict arms, because a plain object would strip `collection` instead of refusing it.
export const systemActionSchema = v.variant("type", [
  ...COLLECTION_ACTION_TYPES.map((type) =>
    v.strictObject({
      type: v.literal(type),
      collection: v.optional(collectionSchema),
    }),
  ),
  ...GLOBAL_ACTION_TYPES.map((type) => v.strictObject({ type: v.literal(type) })),
]);

// oxlint-disable-next-line project/no-unused-module-exports -- Schemas intentionally export validation contracts and inferred types together.
export type SystemAction = v.InferOutput<typeof systemActionSchema>;
