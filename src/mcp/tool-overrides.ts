// ---------------------------------------------------------------------------
// Curation layer for downstream projects.
//
// Tools are derived from the OpenAPI document, so adding a REST endpoint is all it takes to get an
// agent tool. This map is the escape hatch when the derived surface needs a human touch: rename a
// tool, sharpen its description for an agent, or hide it entirely. Keyed by `operationId`.
//
// Hiding can also be declared next to the route itself with `...hiddenFromMcp()` in its
// `describeRoute` options, which keeps the decision where the endpoint lives.
// ---------------------------------------------------------------------------

export interface McpToolOverride {
  /** Keep the endpoint in the REST API and the docs, but never advertise it as a tool. */
  hidden?: boolean;
  /** Rename the tool; the REST operationId is unaffected. */
  name?: string;
  title?: string;
  description?: string;
}

export const MCP_TOOL_OVERRIDES: Record<string, McpToolOverride> = {};
