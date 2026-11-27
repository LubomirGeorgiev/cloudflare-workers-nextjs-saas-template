import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDB: vi.fn() }));

const { selectTeamOwnerRecipients } = await import("./team-owners");

const DAY_MS = 24 * 60 * 60 * 1000;

function ownerRow(overrides: Partial<Parameters<typeof selectTeamOwnerRecipients>[0][number]> = {}) {
  return {
    email: "owner@example.com",
    firstName: "Owner",
    preferredLocale: null,
    isActive: 1,
    expiresAt: null,
    ...overrides,
  };
}

describe("selecting team owner recipients", () => {
  test("keeps an active owner with no expiry and an owner whose expiry is in the future", () => {
    const recipients = selectTeamOwnerRecipients([
      ownerRow({ email: "a@example.com" }),
      ownerRow({ email: "b@example.com", expiresAt: new Date(Date.now() + DAY_MS) }),
    ]);

    expect(recipients.map((recipient) => recipient.email)).toEqual(["a@example.com", "b@example.com"]);
  });

  test("drops an expired owner, an inactive owner, and an owner with no email", () => {
    const recipients = selectTeamOwnerRecipients([
      ownerRow({ email: "expired@example.com", expiresAt: new Date(Date.now() - DAY_MS) }),
      ownerRow({ email: "inactive@example.com", isActive: 0 }),
      ownerRow({ email: null }),
    ]);

    expect(recipients).toEqual([]);
  });

  test("falls back to the email when the first name is blank", () => {
    expect(selectTeamOwnerRecipients([ownerRow({ firstName: "  " })])[0]?.username).toBe("owner@example.com");
  });
});
