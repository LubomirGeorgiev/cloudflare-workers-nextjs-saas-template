// Vendor extension keys the generated document carries, alongside `x-audience` in `./audience.ts`.
// Neutral on purpose: the document producer declares an extension, a reader interprets it, and
// neither has to import the other to agree on the key.

/** Spec extension a route sets to `false` to keep its operation out of the MCP tool surface. */
export const MCP_EXTENSION_KEY = "x-mcp";

// Spread into a route's `apiOperation` options to keep the endpoint out of the MCP tool surface
// while leaving it in the REST API and the docs. The decision then lives next to the endpoint.
// oxlint-disable-next-line project/no-unused-module-exports -- Template extension point.
export function hiddenFromMcp(): Record<string, unknown> {
  return { [MCP_EXTENSION_KEY]: false };
}
