import { expect, test } from "vitest";

import { collectionSlugs } from "@/../cms.config";
import { v } from "@/lib/validation";
import { systemActionSchema } from "@/schemas/system-action.schema";

// A fork renames its collections, so the slug comes from the configuration, never from a literal.
const [collection] = collectionSlugs;

// A flat object dropped `collection` on an action that has no collection, so a caller could send a
// meaningless pair and read success. The variant makes that pair a rejected input instead.
test("a collection is accepted only by the two search actions", () => {
  expect(v.safeParse(systemActionSchema, { type: "rebuild-search-index" }).success).toBe(true);
  expect(v.safeParse(systemActionSchema, { type: "clear-search-cache", collection }).success).toBe(
    true,
  );
  expect(
    v.safeParse(systemActionSchema, { type: "purge-workers-cdn-cache", collection }).success,
  ).toBe(false);
});

test("an unknown action type is rejected", () => {
  expect(v.safeParse(systemActionSchema, { type: "drop-everything" }).success).toBe(false);
});
