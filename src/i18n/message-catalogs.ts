import { lazyValueByKey } from "@/utils/lazy-value";
import type { Locale } from "./config";

// String arrays are valid leaves (accessed via t.raw, e.g. plan feature lists).
export interface MessageTree {
  [key: string]: string | string[] | MessageTree;
}

/** Catalog shape, anchored to the default locale. `typeof import()` is a type, never a load. */
type MessageCatalog = typeof import("./messages/en.json");

// One `import()` per locale, never a static import: a statically imported catalog is evaluated on
// every cold isolate whether or not the request serves that language, and each is ~66 KiB.
// Adding a locale adds a line here and costs the startup budget nothing.
export const CATALOG_LOADERS = {
  en: async () => (await import("./messages/en.json")).default,
  es: async () => (await import("./messages/es.json")).default,
} satisfies Record<Locale, () => Promise<MessageCatalog>>;

// A locale's own catalog, held for the isolate because it is inert data; see `lazyValueByKey`.
// Nothing merges the default catalog in, so a key a translation omits renders its raw path;
// `messages.test.ts` proves no catalog has one. A fork with partial translations merges here.
export const loadCatalog = lazyValueByKey(
  (locale: Locale): Promise<MessageCatalog> => CATALOG_LOADERS[locale](),
);
