import { lazyValueByKey } from "@/utils/lazy-value";
import type { Locale } from "./config";

// String arrays are valid leaves (accessed via t.raw, e.g. plan feature lists); the
// fallback merge treats them like strings — replaced wholesale, never merged per-item.
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
  // A translation may lag the default catalog; `loadMessages` merges the gaps, so key-for-key
  // parity is not required of the JSON itself.
  es: async () => (await import("./messages/es.json")).default as MessageCatalog,
} satisfies Record<Locale, () => Promise<MessageCatalog>>;

/** A catalog is inert data, so it is held for the isolate; see `lazyValueByKey` for the contract. */
export const loadCatalog = lazyValueByKey(
  (locale: Locale): Promise<MessageCatalog> => CATALOG_LOADERS[locale](),
);
