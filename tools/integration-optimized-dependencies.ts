// Pre-bundled for the integration tests. The Workers test pool otherwise sends a package to
// `workerd` one module at a time, again for every test file. List every subpath the app imports:
// an unlisted one loads a second copy of the package, so `instanceof` across the copies fails.
// Keep `hono` out: `hono-openapi` imports its subpaths, which this list cannot cover.
export const INTEGRATION_OPTIMIZED_DEPENDENCIES = [
  "@oslojs/encoding",
  "drizzle-orm",
  "drizzle-orm/d1",
  "drizzle-orm/sqlite-core",
  "rehype-parse",
  "rehype-remark",
  "remark-gfm",
  "remark-stringify",
  "stripe",
  "unified",
  "use-intl/core",
  "use-intl/react",
  "valibot",
];
