import { describe, expect, test } from "vitest";

import { getAppSidebarData } from "./app-sidebar-data";
import type { SessionValidationResult } from "@/types";

describe("getAppSidebarData", () => {
  test("includes the admin panel link from a server-provided admin session", () => {
    const data = getAppSidebarData({
      session: createSession({ role: "admin" }),
    });

    expect(data.navMain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Admin Panel",
          url: "/admin",
        }),
      ]),
    );
  });

  test("does not include the admin panel link for a non-admin session", () => {
    const data = getAppSidebarData({
      session: createSession({ role: "user" }),
    });

    expect(data.navMain).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Admin Panel",
          url: "/admin",
        }),
      ]),
    );
  });
});

function createSession({ role }: { role: "admin" | "user" }) {
  const now = new Date("2026-05-29T12:00:00.000Z");

  return {
    id: "session-1",
    userId: "user-1",
    expiresAt: now.getTime() + 60_000,
    createdAt: now.getTime(),
    user: {
      id: "user-1",
      firstName: "Test",
      lastName: "User",
      email: "user@example.com",
      role,
      emailVerified: null,
      avatar: null,
      currentCredits: 0,
      lastCreditRefreshAt: null,
      createdAt: now,
      updatedAt: now,
    },
  } satisfies SessionValidationResult;
}
