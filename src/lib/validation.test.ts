import { describe, expect, test } from "vitest";

import { trimmedString, v } from "@/lib/validation";

const LABEL_MIN_LENGTH = 1;
const LABEL_MAX_LENGTH = 8;
const GENEROUS_MAX_LENGTH = 64;

const labelSchema = trimmedString({ min: LABEL_MIN_LENGTH, max: LABEL_MAX_LENGTH });
const generousLabelSchema = trimmedString({
  min: LABEL_MIN_LENGTH,
  max: GENEROUS_MAX_LENGTH,
});

// Values made only of invisible non-whitespace characters: `v.trim()` leaves them intact, so they
// used to satisfy `minLength` and persist as a visually blank label.
const invisibleOnlyValues: Record<string, string> = {
  "zero-width spaces": "​​",
  "hangul filler": "ㅤ",
  "soft hyphen": "­",
  "word joiner": "⁠",
  "right-to-left override": "‮",
};

// Invisible characters that carry meaning next to visible ones: ZWJ binds emoji sequences, ZWNJ is
// orthographically required in Persian and Hindi, and bidi marks set the direction of real text.
const visibleValues: Record<string, string> = {
  ascii: "Acme",
  "emoji zero-width joiner sequence": "\u{1F469}‍\u{1F4BB} Team",
  "multi-person emoji sequence": "\u{1F468}‍\u{1F469}‍\u{1F467}",
  "persian zero-width non-joiner": "می‌خواهم",
  "hindi zero-width non-joiner": "क्‌ष",
  "bidi mark beside letters": "‏شركة",
  "embedded zero-width space": "Acme​Corp",
};

describe("trimmedString", () => {
  for (const [name, value] of Object.entries(invisibleOnlyValues)) {
    test(`rejects a value made only of ${name}`, () => {
      expect(v.safeParse(labelSchema, value).success).toBe(false);
    });
  }

  for (const [name, value] of Object.entries(visibleValues)) {
    test(`accepts ${name}`, () => {
      expect(v.safeParse(generousLabelSchema, value).success).toBe(true);
    });
  }

  test("still trims surrounding whitespace", () => {
    const result = v.safeParse(labelSchema, "  Acme  ");

    expect(result.success && result.output).toBe("Acme");
  });

  test("rejects a whitespace-only value", () => {
    expect(v.safeParse(labelSchema, "   ").success).toBe(false);
  });

  test("reports the caller's min message for an invisible-only value", () => {
    const minMessage = "min-message";
    const schema = trimmedString({ min: LABEL_MIN_LENGTH, max: LABEL_MAX_LENGTH, minMessage });
    const result = v.safeParse(schema, "​");

    expect(result.success).toBe(false);
    expect(result.issues?.[0]?.message).toBe(minMessage);
  });

  test("an oversized invisible payload trips the length check first", () => {
    const maxMessage = "max-message";
    const schema = trimmedString({ min: LABEL_MIN_LENGTH, max: LABEL_MAX_LENGTH, maxMessage });
    const result = v.safeParse(schema, "​".repeat(LABEL_MAX_LENGTH + 1));

    expect(result.success).toBe(false);
    expect(result.issues?.[0]?.message).toBe(maxMessage);
  });
});
