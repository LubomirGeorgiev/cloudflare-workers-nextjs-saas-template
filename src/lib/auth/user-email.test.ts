import { describe, expect, test, vi } from "vitest";

import { userByEmailWhere } from "./user-email";

vi.mock("server-only", () => ({}));

function renderPredicate(email: string) {
  const sqlSpy = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: Array.from(strings).join("?"),
    values,
  }));

  return userByEmailWhere(email).RAW({ email: "user.email" } as never, { sql: sqlSpy as never }) as unknown as {
    text: string;
    values: unknown[];
  };
}

describe("userByEmailWhere", () => {
  // Legacy rows can hold mixed case, so the column side is lowered too.
  test("compares lower(email) with the canonical input", () => {
    const predicate = renderPredicate(" Victim@Example.COM ");

    expect(predicate.text.toLowerCase()).toContain("lower(");
    expect(predicate.values).toContain("victim@example.com");
    expect(predicate.values).not.toContain(" Victim@Example.COM ");
  });
});
