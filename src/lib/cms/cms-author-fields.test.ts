import { describe, expect, test } from "vitest";

import { CMS_AUTHOR_COLUMNS, hasCmsAuthorFieldChange, type CmsAuthorFields } from "./cms-author-fields";

const author: CmsAuthorFields = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  avatar: null,
};

const renderedFields = Object.keys(CMS_AUTHOR_COLUMNS).filter(
  (field): field is keyof CmsAuthorFields => field !== "id",
);

describe("hasCmsAuthorFieldChange", () => {
  test("is false when no rendered field changed", () => {
    expect(hasCmsAuthorFieldChange({ before: author, after: { ...author } })).toBe(false);
  });

  test.each(renderedFields)("is true when %s changed", (field) => {
    expect(hasCmsAuthorFieldChange({ before: author, after: { ...author, [field]: "changed" } })).toBe(true);
  });

  test("is true when a field is cleared", () => {
    expect(hasCmsAuthorFieldChange({ before: author, after: { ...author, lastName: null } })).toBe(true);
  });

  test("ignores a column that public pages do not render", () => {
    const before = { ...author, role: "user" };
    const after = { ...author, role: "admin" };

    expect(hasCmsAuthorFieldChange({ before, after })).toBe(false);
  });
});
