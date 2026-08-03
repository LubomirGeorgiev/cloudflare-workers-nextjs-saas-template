import type { ComponentType } from "react";
import type { Route } from "next";
import {
  Building2,
  CreditCard,
  Frame,
  Map,
  PieChart,
  Settings2,
  Shield,
  SquareTerminal,
  Users,
} from "lucide-react";

import { ROLES_ENUM } from "@/app/enums";
import { SETTINGS_API_MCP_PATH } from "@/constants";
import type { SessionValidationResult } from "@/types";
import type messages from "@/i18n/messages/en.json";

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
    name: string;
    logo: ComponentType;
    role: string;
  }[];
  navMain: NavMainItem[];
  projects: NavItem[];
}

export function getAppSidebarData({
  session,
  billingEnabled = true,
}: {
  session: SessionValidationResult | null;
  // Server-evaluated isBillingEnabled(); when false the Billing nav item is hidden
  // (the flag hides billing UI entirely, not just the destination page).
  billingEnabled?: boolean;
}): AppSidebarData {
  return {
    user: {
      name: session?.user?.firstName || "User",
      email: session?.user?.email || "user@example.com",
    },
    teams: session?.teams?.map((team) => ({
      id: team.id,
      name: team.name,
      // TODO Get the actual logo when we implement team avatars
      logo: Building2,
      role: team.role.name || "Member",
    })) ?? [],
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
        url: "/dashboard/teams" as Route,
        icon: Users,
      },
      ...(billingEnabled ? [
        {
          title: "Billing",
          titleKey: "billing",
          url: "/dashboard/billing",
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
    projects: [
      {
        title: "Design Engineering",
        titleKey: "designEngineering",
        url: "#",
        icon: Frame,
      },
      {
        title: "Sales & Marketing",
        titleKey: "salesMarketing",
        url: "#",
        icon: PieChart,
      },
      {
        title: "Travel",
        titleKey: "travel",
        url: "#",
        icon: Map,
      },
    ],
  };
}
