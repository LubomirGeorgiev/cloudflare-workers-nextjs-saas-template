import { coerceNumber, requiredString, v } from "@/lib/validation";
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/i18n/config";

export const docsSearchQuerySchema = v.object({
  q: v.pipe(requiredString(), v.trim(), v.maxLength(100)),
  limit: v.optional(v.pipe(coerceNumber(), v.integer(), v.minValue(1), v.maxValue(20)), 8),
  // Scope results to the active locale so /es searches don't surface English rows.
  // Only served locales are valid — with i18n disabled this narrows to the default.
  locale: v.optional(v.picklist(ENABLED_LOCALES), DEFAULT_LOCALE),
});

// oxlint-disable project/no-unused-module-exports -- Schemas intentionally export validation contracts and inferred types together.
// fallow-ignore-next-line unused-type
export type DocsSearchQuery = v.InferOutput<typeof docsSearchQuerySchema>;
// oxlint-enable project/no-unused-module-exports
