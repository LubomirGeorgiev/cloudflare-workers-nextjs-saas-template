import type { ComponentType } from "react";
import type { Route } from "next";
import {
  Building2,
  CreditCard,
  Settings2,
  Shield,
  SquareTerminal,
  Users,
} from "lucide-react";

import { ROLES_ENUM } from "@/app/enums";
import { SETTINGS_API_MCP_PATH } from "@/constants";
import type { SessionValidationResult } from "@/types";
import { getActiveTeam, getTeamSectionPath } from "@/utils/active-team";
import type messages from "@/i18n/messages/en.json";
import type { SessionTeamRole } from "@/lib/teams/team-role-labels";

// Valid keys under the `Client.Sidebar.nav.*` message namespace, derived from the
// source catalog so the type stays in sync without duplicating the key list.
type SidebarNavKey = keyof (typeof messages)["Client"]["Sidebar"]["nav"];

export type NavItem = {
  title: string;
  // Stable i18n key (under the `Sidebar.nav.*` namespace) used to translate the
  // title at render time. `title` is kept as a stable English fallback so the
  // data builder stays a pure, translation-free module (see app-sidebar-data.test.ts).
  titleKey?: SidebarNavKey;
  url: Route;
  icon?: ComponentType;
}

export type NavMainItem = NavItem & {
  isActive?: boolean;
  items?: NavItem[];
}

type AppSidebarData = {
  user: {
    name: string;
    email: string;
  };
  teams: {
    id: string;
    slug: string;
    name: string;
    logo: ComponentType;
    role: SessionTeamRole;
  }[];
  activeTeamId?: string;
  // The one billing path for the nav and the user menu; null hides both.
  billingUrl: Route | null;
  navMain: NavMainItem[];
}

export function getAppSidebarData({
  session,
  billingEnabled = true,
  teamSlug,
}: {
  session: SessionValidationResult | null;
  // Server-evaluated isBillingEnabled(); when false the Billing nav item is hidden
  // (the flag hides billing UI entirely, not just the destination page).
  billingEnabled?: boolean;
  // The `[teamSlug]` route param of the current page, if any.
  teamSlug?: string;
}): AppSidebarData {
  const activeTeam = getSessionActiveTeam({ session, teamSlug });
  const billingUrl = getSidebarBillingUrl({ session, billingEnabled, teamSlug });

  return {
    user: {
      name: session?.user?.firstName || "User",
      email: session?.user?.email || "user@example.com",
    },
    teams: session?.teams?.map((team) => ({
      id: team.id,
      slug: team.slug,
      name: team.name,
      // TODO Get the actual logo when we implement team avatars
      logo: Building2,
      role: team.role,
    })) ?? [],
    activeTeamId: activeTeam?.id,
    billingUrl,
    navMain: [
      {
        title: "Dashboard",
        titleKey: "dashboard",
        url: "/dashboard",
        icon: SquareTerminal,
        isActive: true,
      },
      {
        title: "Teams",
        titleKey: "teams",
        url: "/dashboard/teams",
        icon: Users,
      },
      ...(billingUrl ? [
        {
          title: "Billing",
          titleKey: "billing",
          url: billingUrl,
          icon: CreditCard,
        } as NavMainItem,
      ] : []),
      {
        title: "Settings",
        titleKey: "settings",
        url: "/settings",
        icon: Settings2,
        items: [
          {
            title: "Profile",
            titleKey: "profile",
            url: "/settings",
          },
          {
            title: "Security",
            titleKey: "security",
            url: "/settings/security",
          },
          {
            title: "Sessions",
            titleKey: "sessions",
            url: "/settings/sessions",
          },
          {
            title: "API & MCP",
            titleKey: "apiMcp",
            url: SETTINGS_API_MCP_PATH,
          },
          {
            title: "Change Password",
            titleKey: "changePassword",
            url: "/forgot-password",
          },
        ],
      },
      ...(session?.user?.role === ROLES_ENUM.ADMIN ? [
        {
          title: "Admin Panel",
          titleKey: "adminPanel",
          url: "/admin",
          icon: Shield,
        } as NavMainItem,
      ] : []),
    ],
  };
}

// The admin sidebar calls this too, so its user menu opens the same team and obeys the same flag.
export function getSidebarBillingUrl({
  session,
  billingEnabled,
  teamSlug,
}: {
  session: SessionValidationResult | null;
  billingEnabled: boolean;
  teamSlug?: string;
}): Route | null {
  if (!billingEnabled) {
    return null;
  }

  const activeTeam = getSessionActiveTeam({ session, teamSlug });

  return getBillingUrl({ teamSlug: activeTeam?.slug });
}

export function getBillingUrl({ teamSlug }: { teamSlug?: string }): Route {
  return teamSlug ? getTeamSectionPath({ teamSlug, section: "billing" }) : "/dashboard/billing";
}

function getSessionActiveTeam({
  session,
  teamSlug,
}: {
  session: SessionValidationResult | null;
  teamSlug?: string;
}) {
  return getActiveTeam({
    teams: session?.teams ?? [],
    teamSlug,
    selectedTeamId: session?.selectedTeam,
  });
}
