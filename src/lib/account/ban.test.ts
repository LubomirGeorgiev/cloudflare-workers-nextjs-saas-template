import { describe, expect, it } from "vitest";

import { ActionError } from "@/lib/action-error";
import { assertNotBanned, isBanned } from "@/lib/account/ban";

describe("isBanned", () => {
  it("reads a Date, and the string KV round-trips it into, the same way", () => {
    expect(isBanned({ bannedAt: new Date() })).toBe(true);
    expect(isBanned({ bannedAt: new Date().toISOString() })).toBe(true);
    expect(isBanned({ bannedAt: Date.now() })).toBe(true);
  });

  it("treats an absent stamp as not banned", () => {
    expect(isBanned({ bannedAt: null })).toBe(false);
    expect(isBanned({ bannedAt: undefined })).toBe(false);
  });
});

describe("assertNotBanned", () => {
  it("passes an account that is not banned", () => {
    expect(() => assertNotBanned({ bannedAt: null })).not.toThrow();
  });

  it("refuses a banned account with the suspended message, not invalid credentials", () => {
    let thrown: unknown;

    try {
      assertNotBanned({ bannedAt: new Date() });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ActionError);
    expect(thrown).toMatchObject({
      code: "FORBIDDEN",
      messageKey: "Client.Auth.SignIn.errorAccountSuspended",
    });
  });
});
