import { describe, expect, test } from "vitest"

import { getBlogPagePath } from "./blog-routing"

describe("getBlogPagePath", () => {
  // Page one is the bare list path, never `/blog/1` — the two would be duplicate URLs for one page.
  test("keeps page one on the bare list path", () => {
    expect(getBlogPagePath({ page: 1 })).toBe("/blog")
  })

  test("numbers every later page", () => {
    expect(getBlogPagePath({ page: 2 })).toBe("/blog/2")
  })
})
