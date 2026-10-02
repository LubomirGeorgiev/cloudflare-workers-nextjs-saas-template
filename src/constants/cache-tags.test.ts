import { describe, expect, test } from "vitest";

import { CACHE_TAG_MAX_LENGTH, SLUG_MAX_LENGTH } from "@/constants";

import { CACHE_TAGS, formatCacheTagHeader } from "./cache-tags";

const COLLECTION_SLUG = "blog";
// Each CJK character encodes to nine characters, so a full-length slug overflows one tag.
const LONG_UNICODE_SLUG = "文".repeat(SLUG_MAX_LENGTH);
const LONG_ASCII_SLUG = "a".repeat(SLUG_MAX_LENGTH);
// The characters Vinext's KV data cache refuses in a tag (`validateTag` in `@vinext/cloudflare`).
const KV_REFUSED_TAG_CHARACTERS = /[\x00-\x1f\\:]/;

function entryTag(slug: string): string {
  return CACHE_TAGS.cmsEntry({ collectionSlug: COLLECTION_SLUG, slug });
}

// The longest ASCII slug whose tag still fits, derived from the builder so a fork's prefix holds.
const LONGEST_VERBATIM_SLUG_LENGTH = CACHE_TAG_MAX_LENGTH - entryTag("").length;

describe("CACHE_TAGS", () => {
  // A changed tag for an existing slug would strand the copies stored under the old one.
  test("keeps an ASCII slug verbatim while the whole tag fits the bound", () => {
    const slug = "a".repeat(LONGEST_VERBATIM_SLUG_LENGTH);

    expect(entryTag(slug)).toBe(`${entryTag("")}${slug}`);
    expect(entryTag(slug)).toHaveLength(CACHE_TAG_MAX_LENGTH);
  });

  test("keeps a short Unicode slug percent-encoded", () => {
    const slug = "日本語";

    expect(entryTag(slug)).toContain(encodeURIComponent(slug));
  });

  test.each([
    { name: "a full-length ASCII slug", slug: LONG_ASCII_SLUG },
    { name: "a one-over ASCII slug", slug: "a".repeat(LONGEST_VERBATIM_SLUG_LENGTH + 1) },
    { name: "a full-length CJK slug", slug: LONG_UNICODE_SLUG },
  ])("keeps $name within the tag bound", ({ slug }) => {
    expect(entryTag(slug).length).toBeLessThanOrEqual(CACHE_TAG_MAX_LENGTH);
  });

  test.each([LONG_ASCII_SLUG, LONG_UNICODE_SLUG])(
    "gives a long slug the same tag on every call and a different tag than another slug",
    (slug) => {
      const otherSlug = `${slug.slice(1)}b`;

      expect(entryTag(slug)).toBe(entryTag(slug));
      expect(entryTag(otherSlug)).not.toBe(entryTag(slug));
    },
  );

  test("never holds a character the KV data cache refuses, or a comma", () => {
    const tags = [
      entryTag("a:b\\c\u0001d,e"),
      CACHE_TAGS.cmsCollection("x:y"),
      CACHE_TAGS.cmsNavigation("x\\y"),
      entryTag(`${"a".repeat(SLUG_MAX_LENGTH - 1)}:`),
    ];

    for (const tag of tags) {
      expect(tag).not.toMatch(KV_REFUSED_TAG_CHARACTERS);
      expect(tag).not.toContain(",");
    }
  });
});

describe("formatCacheTagHeader", () => {
  test("joins tags with commas and drops duplicates", () => {
    const blog = CACHE_TAGS.cmsCollection("blog");

    expect(formatCacheTagHeader([CACHE_TAGS.CMS_TAGS, blog, CACHE_TAGS.CMS_TAGS])).toBe(
      `${CACHE_TAGS.CMS_TAGS},${blog}`,
    );
  });

  test("returns an empty string for no tags", () => {
    expect(formatCacheTagHeader([])).toBe("");
  });
});
