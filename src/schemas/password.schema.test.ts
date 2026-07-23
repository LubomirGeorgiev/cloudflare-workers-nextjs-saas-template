import { describe, expect, test } from "vitest";

import { v } from "@/lib/validation";
import {
  LEGACY_PASSWORD_MAX_LENGTH,
  LEGACY_PASSWORD_MIN_LENGTH,
  newPasswordSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordVerificationSchema,
} from "./password.schema";

describe("newPasswordSchema", () => {
  test("requires the current minimum length", () => {
    expect(v.safeParse(newPasswordSchema, "a".repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(false);
    expect(v.safeParse(newPasswordSchema, "a".repeat(PASSWORD_MIN_LENGTH)).success).toBe(true);
  });

  test("enforces the maximum length", () => {
    expect(v.safeParse(newPasswordSchema, "a".repeat(PASSWORD_MAX_LENGTH)).success).toBe(true);
    expect(v.safeParse(newPasswordSchema, "a".repeat(PASSWORD_MAX_LENGTH + 1)).success).toBe(false);
  });

  test("allows arbitrary characters without composition rules", () => {
    expect(v.safeParse(newPasswordSchema, "correct horse 🐴 battery staple").success).toBe(true);
  });
});

describe("passwordVerificationSchema", () => {
  test("continues to accept passwords created under the legacy policy", () => {
    expect(
      v.safeParse(passwordVerificationSchema, "a".repeat(LEGACY_PASSWORD_MIN_LENGTH)).success
    ).toBe(true);
    expect(v.safeParse(passwordVerificationSchema, "a".repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(
      true
    );
    expect(v.safeParse(passwordVerificationSchema, "a".repeat(PASSWORD_MAX_LENGTH + 1)).success).toBe(
      true
    );
  });

  test("still bounds verification input", () => {
    expect(
      v.safeParse(passwordVerificationSchema, "a".repeat(LEGACY_PASSWORD_MIN_LENGTH - 1)).success
    ).toBe(false);
    expect(
      v.safeParse(passwordVerificationSchema, "a".repeat(LEGACY_PASSWORD_MAX_LENGTH + 1)).success
    ).toBe(false);
  });
});
