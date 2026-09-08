import { loadCatalog } from "./message-catalogs";

// A locale loads exactly its own catalog — no deep merge under the default locale. next-intl has no
// cross-locale fallback, so a key a translation omits would render its raw path; `messages.test.ts`
// proves every catalog carries the default catalog's full key set, which is what makes a runtime
// merge (a second 66 KiB catalog per isolate) unnecessary. A downstream project that ships partial
// translations should drop that test and merge here instead.
//
// The catalogs are `import()`ed per locale, so this stays async — a statically imported catalog is
// startup cost on every isolate. Deliberately free of `next-intl/server` and `next/headers`: the API
// and MCP entrypoints run outside the App Router graph, where importing either one throws.
export const loadMessages = loadCatalog;
