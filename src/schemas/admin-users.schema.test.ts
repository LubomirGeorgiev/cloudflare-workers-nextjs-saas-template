import { describe, expect, test } from "vitest";

import { v } from "@/lib/validation";
import { banUserSchema, unbanUserSchema } from "@/schemas/admin-users.schema";
import {
  adminBanUserBodySchema,
  adminUnbanUserBodySchema,
} from "@/schemas/api/admin.schema";

// The notification default exists once, in `banDecisionFields`. These assertions pin it for every
// door, so changing it becomes a deliberate act with a failing test attached rather than a quiet
// behaviour change in one of four places.

const DOORS = [
  ["the ban server action", banUserSchema, { userId: "usr_1" }],
  ["the unban server action", unbanUserSchema, { userId: "usr_1" }],
  ["the ban REST body", adminBanUserBodySchema, {}],
  ["the unban REST body", adminUnbanUserBodySchema, {}],
] as const;

describe("the ban decision", () => {
  test.each(DOORS)("%s emails the user by default", (_door, schema, extra) => {
    const parsed = v.parse(schema, { ...extra, internalReason: "card testing" }) as {
      sendEmail: boolean;
      externalReason?: string;
    };

    expect(parsed.sendEmail).toBe(true);
    // An internal-only ban is the DEFAULT shape: staff have to type something into the external
    // field before the account holder is told anything beyond "your account is suspended".
    expect(parsed.externalReason).toBeUndefined();
  });

  test.each(DOORS)("%s requires an internal reason", (_door, schema, extra) => {
    expect(() => v.parse(schema, { ...extra })).toThrow();
    expect(() => v.parse(schema, { ...extra, internalReason: "" })).toThrow();
    // Trimmed before the length check: whitespace is not a reason anybody can read later.
    expect(() => v.parse(schema, { ...extra, internalReason: "   \n\t " })).toThrow();
  });

  test.each(DOORS)("%s stores the internal reason trimmed", (_door, schema, extra) => {
    const parsed = v.parse(schema, { ...extra, internalReason: "  card testing  " }) as {
      internalReason: string;
    };

    expect(parsed.internalReason).toBe("card testing");
  });

  // The structural guarantee from the two-field design: `internalReason` is not filtered out of
  // the notice payload, it has nowhere to go. This is the cheap CI-enforced half of that.
  test.each(DOORS)("%s never parses input into an emailable internal field", (_door, schema, extra) => {
    const inputs = [
      { internalReason: "a" },
      { internalReason: "a", externalReason: "b" },
      { internalReason: "a", sendEmail: false },
      { internalReason: "a", externalReason: "b", sendEmail: true },
    ];

    for (const input of inputs) {
      const parsed = v.parse(schema, { ...extra, ...input }) as Record<string, unknown>;

      expect(parsed).toHaveProperty("internalReason");
      // Whatever the door, the only field that can reach the recipient is the external one.
      expect(Object.keys(parsed).filter((key) => key.startsWith("external")))
        .toEqual(input.externalReason === undefined ? [] : ["externalReason"]);
    }
  });
});
