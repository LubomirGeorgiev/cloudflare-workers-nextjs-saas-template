import { describe, expect, test } from "vitest";

import { getAppSidebarData, getBillingUrl, getSidebarBillingUrl } from "./app-sidebar-data";
import { SETTINGS_API_MCP_PATH } from "@/constants";
import type { SessionValidationResult } from "@/types";
import { getTeamSectionPath } from "@/utils/active-team";

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

  test("hides the billing nav item and the user-menu billing path when billing is off", () => {
    const data = getAppSidebarData({
      session: createSessionWithTeam(),
      billingEnabled: false,
    });

    expect(data.billingUrl).toBeNull();
    expect(data.navMain.find((item) => item.titleKey === "billing")).toBeUndefined();
  });

  test("shows the billing nav item and the user-menu billing path when billing is on", () => {
    const data = getAppSidebarData({
      session: createSessionWithTeam(),
      billingEnabled: true,
    });
    const alphaBilling = getTeamSectionPath({ teamSlug: "alpha", section: "billing" });

    expect(data.billingUrl).toBe(alphaBilling);
    expect(data.navMain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ titleKey: "billing", url: alphaBilling }),
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

  test("points billing and the active team at the team in the URL", () => {
    const session = {
      ...createSession({ role: "user" }),
      teams: [createTeam({ id: "team-a", slug: "alpha" }), createTeam({ id: "team-b", slug: "beta" })],
      selectedTeam: "team-a",
    };

    const onTeamPage = getAppSidebarData({ session, teamSlug: "beta" });
    const betaBilling = getTeamSectionPath({ teamSlug: "beta", section: "billing" });
    expect(onTeamPage.activeTeamId).toBe("team-b");
    expect(onTeamPage.billingUrl).toBe(betaBilling);
    expect(onTeamPage.navMain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ titleKey: "billing", url: betaBilling }),
      ]),
    );

    const offTeamPage = getAppSidebarData({ session });
    const alphaBilling = getTeamSectionPath({ teamSlug: "alpha", section: "billing" });
    expect(offTeamPage.activeTeamId).toBe("team-a");
    expect(offTeamPage.billingUrl).toBe(alphaBilling);
    expect(offTeamPage.navMain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ titleKey: "billing", url: alphaBilling }),
      ]),
    );
  });

  test("gives the user menu the same billing path as the nav item", () => {
    const session = {
      ...createSession({ role: "user" }),
      teams: [createTeam({ id: "team-a", slug: "alpha" })],
      selectedTeam: "team-a",
    };

    const data = getAppSidebarData({ session });
    const billingItem = data.navMain.find((item) => item.titleKey === "billing");
    expect(billingItem?.url).toBe(data.billingUrl);
  });

  test("falls back to the team-less billing path without a team", () => {
    const data = getAppSidebarData({ session: createSession({ role: "user" }) });

    expect(data.billingUrl).toBe(getBillingUrl({}));
    expect(data.navMain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ titleKey: "billing", url: data.billingUrl }),
      ]),
    );
  });

  test("gives the admin sidebar the same billing path as the app sidebar", () => {
    const session = createSessionWithTeam();

    for (const billingEnabled of [true, false]) {
      expect(getSidebarBillingUrl({ session, billingEnabled })).toBe(
        getAppSidebarData({ session, billingEnabled }).billingUrl,
      );
    }
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

  test("links every nav item to an app path, not a placeholder", () => {
    const data = getAppSidebarData({
      session: createSession({ role: "admin" }),
    });

    const urls = data.navMain.flatMap((item) => [
      item.url,
      ...(item.items ?? []).map((subItem) => subItem.url),
    ]);
    for (const url of urls) {
      expect(url).toMatch(/^\/[^#]*$/);
    }
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

function createSessionWithTeam() {
  return {
    ...createSession({ role: "user" }),
    teams: [createTeam({ id: "team-a", slug: "alpha" })],
    selectedTeam: "team-a",
  };
}

function createTeam({ id, slug }: { id: string; slug: string }) {
  return {
    id,
    slug,
    name: slug,
    role: { id: "member", name: "Member", isSystemRole: true },
    permissions: [],
    planId: null,
    subscriptionStatus: null,
  };
}
