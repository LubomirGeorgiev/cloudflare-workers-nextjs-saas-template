// Virtual modules served by vite plugins in `tools/` and by Vinext. They have no file on disk, so
// their types are declared here rather than inferred.

// Vinext generates it from the `cache` option in `vite.config.ts` (`VINEXT_CACHE_CONFIG`).
declare module "virtual:vinext-cache-adapters" {
  export function registerConfiguredCacheAdapters(env: unknown): void;
}

declare module "virtual:api-openapi-document" {
  /** The OpenAPI document as JSON text, generated at build time by `tools/openapi-document.ts`. */
  const documentJson: string;

  export default documentJson;
}

// The internal admin document. Never served over HTTP — it is read by the admin panel's reference
// page and by the internal MCP server, both of which are behind `assertAdminPrincipal`.
declare module "virtual:admin-openapi-document" {
  /** The internal OpenAPI document as JSON text, generated at build time alongside the public one. */
  const documentJson: string;

  export default documentJson;
}
