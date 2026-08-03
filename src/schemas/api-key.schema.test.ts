import { describe, expect, test } from "vitest";

import { API_KEY_MAX_EXPIRY_DAYS, API_KEY_NAME_MAX_LENGTH } from "@/constants";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";
import { v } from "@/lib/validation";
import {
  createApiKeySchema,
  revokeApiKeySchema,
  updateApiKeyScopesSchema,
} from "@/schemas/api-key.schema";

function parse(input: unknown) {
  return v.safeParse(createApiKeySchema, input);
}

function parseValid(input: unknown) {
  return v.parse(createApiKeySchema, input);
}

const VALID_SCOPE = API_SCOPE_NAMES[0];

describe("createApiKeySchema", () => {
  test("accepts a name with every catalog scope", () => {
    expect(parseValid({ name: "CI", scopes: [...API_SCOPE_NAMES] }).scopes).toEqual(API_SCOPE_NAMES);
  });

  test("trims the name and rejects a whitespace-only one", () => {
    expect(parseValid({ name: "  CI  ", scopes: [VALID_SCOPE] }).name).toBe("CI");
    expect(parse({ name: "   ", scopes: [VALID_SCOPE] }).success).toBe(false);
  });

  test("enforces the shared name length limit", () => {
    expect(parse({ name: "a".repeat(API_KEY_NAME_MAX_LENGTH), scopes: [VALID_SCOPE] }).success).toBe(true);
    expect(parse({ name: "a".repeat(API_KEY_NAME_MAX_LENGTH + 1), scopes: [VALID_SCOPE] }).success).toBe(false);
  });

  test("requires at least one scope and rejects unknown ones", () => {
    expect(parse({ name: "CI", scopes: [] }).success).toBe(false);
    expect(parse({ name: "CI", scopes: ["definitely:not-a-scope"] }).success).toBe(false);
  });

  test("expiry is optional and bounded", () => {
    expect(parseValid({ name: "CI", scopes: [VALID_SCOPE] }).expiresInDays).toBeUndefined();
    expect(parse({ name: "CI", scopes: [VALID_SCOPE], expiresInDays: 1 }).success).toBe(true);
    expect(parse({ name: "CI", scopes: [VALID_SCOPE], expiresInDays: API_KEY_MAX_EXPIRY_DAYS }).success).toBe(true);
    expect(parse({ name: "CI", scopes: [VALID_SCOPE], expiresInDays: 0 }).success).toBe(false);
    expect(parse({ name: "CI", scopes: [VALID_SCOPE], expiresInDays: 1.5 }).success).toBe(false);
    expect(parse({ name: "CI", scopes: [VALID_SCOPE], expiresInDays: API_KEY_MAX_EXPIRY_DAYS + 1 }).success)
      .toBe(false);
  });

  // Validation copy is localized from stable keys, so no schema message may be inline English.
  test("emits localized validation keys only", () => {
    const result = parse({ name: "", scopes: [] });

    expect(result.success).toBe(false);
    for (const issue of result.issues ?? []) {
      expect(issue.message.startsWith("Validation.")).toBe(true);
    }
  });
});

test("revokeApiKeySchema requires a key id", () => {
  expect(v.safeParse(revokeApiKeySchema, { keyId: "akey_123" }).success).toBe(true);
  expect(v.safeParse(revokeApiKeySchema, { keyId: "" }).success).toBe(false);
});

describe("updateApiKeyScopesSchema", () => {
  test("takes a key id with the full replacement scope set", () => {
    const parsed = v.parse(updateApiKeyScopesSchema, {
      keyId: "akey_123",
      scopes: [...API_SCOPE_NAMES],
    });

    expect(parsed).toEqual({ keyId: "akey_123", scopes: API_SCOPE_NAMES });
  });

  test("rejects a missing key id, an empty scope set, and an unknown scope", () => {
    for (const input of [
      { keyId: "", scopes: [VALID_SCOPE] },
      { scopes: [VALID_SCOPE] },
      { keyId: "akey_123", scopes: [] },
      { keyId: "akey_123", scopes: ["definitely:not-a-scope"] },
    ]) {
      expect(v.safeParse(updateApiKeyScopesSchema, input).success).toBe(false);
    }
  });

  // The edit path deliberately cannot re-issue a name or extend a life; both are dropped, not read.
  test("carries no name or expiry", () => {
    const parsed = v.parse(updateApiKeyScopesSchema, {
      keyId: "akey_123",
      scopes: [VALID_SCOPE],
      name: "renamed",
      expiresInDays: 30,
    });

    expect(Object.keys(parsed).sort()).toEqual(["keyId", "scopes"]);
  });
});
