import { describe, expect, test } from "vitest";

import { TEAM_NAME_MAX_LENGTH } from "@/constants";
import { v } from "@/lib/validation";
import { renameTeamSchema } from "@/schemas/team.schema";

function parseName(name: string) {
  return v.safeParse(renameTeamSchema, { teamId: "team_1", name });
}

describe("renameTeamSchema", () => {
  test("trims surrounding whitespace from the stored name", () => {
    expect(v.parse(renameTeamSchema, { teamId: "team_1", name: "  Acme  " }).name).toBe("Acme");
  });

  test("rejects a whitespace-only name", () => {
    // Trim runs before the emptiness check, so "   " must not survive as "".
    expect(parseName("   ").success).toBe(false);
  });

  test("rejects an empty name", () => {
    expect(parseName("").success).toBe(false);
  });

  test("accepts a name at the maximum length", () => {
    expect(parseName("a".repeat(TEAM_NAME_MAX_LENGTH)).success).toBe(true);
  });

  test("rejects a name one character over the maximum length", () => {
    expect(parseName("a".repeat(TEAM_NAME_MAX_LENGTH + 1)).success).toBe(false);
  });

  test("requires a team id", () => {
    expect(v.safeParse(renameTeamSchema, { teamId: "", name: "Acme" }).success).toBe(false);
  });
});
