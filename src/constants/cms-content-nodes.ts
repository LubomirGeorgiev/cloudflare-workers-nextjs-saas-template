// Tiptap node names that appear in stored CMS content.
//
// They live here, not in the editor components, because the server-side content pipeline reads
// them too: search indexing, text extraction, and translation all match on a node's `type`. Kept
// in a module with no imports of its own so a Worker path that needs one name does not pull the
// whole editor extension tree — and, through it, `src/components/**` — into its bundle and into
// the OpenAPI generator's import graph.

export const ALERT_BLOCK_NODE_NAME = "alertBlock";
