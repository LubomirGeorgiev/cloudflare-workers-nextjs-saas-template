import type { Locale } from "@/i18n/config"

// Section kicker printed on the card. One key per entry in `OgImage` — a union rather than
// `string` so a missing catalog row is a typecheck failure instead of a blank pill.
export type OgEyebrowKey =
  | "blog"
  | "docs"
  | "apiReference"
  | "legal"
  | "account"
  | "tags"
  | "authors"

// Props of an `opengraph-image.tsx` under `app/[locale]/`. Generic over the extra dynamic segments
// the surrounding route contributes (`{ slug: string }`, ...).
export interface OgImageRouteProps<TParams = Record<never, never>> {
  params: Promise<{ locale: Locale } & TParams>
}
