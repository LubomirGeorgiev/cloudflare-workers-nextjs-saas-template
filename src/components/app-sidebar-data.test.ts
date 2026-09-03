import { describe, expect, test } from "vitest";

import { getAppSidebarData } from "./app-sidebar-data";
import { SETTINGS_API_MCP_PATH } from "@/constants";
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

  test("hides the billing nav item when billing is disabled", () => {
    const data = getAppSidebarData({
      session: createSession({ role: "user" }),
      billingEnabled: false,
    });

    expect(data.navMain).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "/dashboard/billing" }),
      ]),
    );
  });

  test("includes the billing nav item by default", () => {
    const data = getAppSidebarData({
      session: createSession({ role: "user" }),
    });

    expect(data.navMain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "/dashboard/billing" }),
      ]),
    );
  });

  test("includes the API & MCP link under settings", () => {
    const data = getAppSidebarData({
      session: createSession({ role: "user" }),
    });

    const settings = data.navMain.find((item) => item.url === "/settings");
    expect(settings?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: SETTINGS_API_MCP_PATH }),
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
    kind: "cookie" as const,
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
      preferredLocale: null,
      bannedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  } satisfies SessionValidationResult;
}
