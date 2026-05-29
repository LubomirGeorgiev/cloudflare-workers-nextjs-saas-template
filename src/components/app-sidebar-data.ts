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
  ShoppingCart,
  SquareTerminal,
  Users,
} from "lucide-react";

import { ROLES_ENUM } from "@/app/enums";
import { DISABLE_CREDIT_BILLING_SYSTEM } from "@/constants";
import type { SessionValidationResult } from "@/types";

export type NavItem = {
  title: string;
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
}: {
  session: SessionValidationResult | null;
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
        url: "/dashboard",
        icon: SquareTerminal,
        isActive: true,
      },
      {
        title: "Teams",
        url: "/dashboard/teams" as Route,
        icon: Users,
      },
      ...(!DISABLE_CREDIT_BILLING_SYSTEM ? [{
        title: "Marketplace",
        url: "/dashboard/marketplace" as Route,
        icon: ShoppingCart,
      }] : []),
      {
        title: "Billing",
        url: "/dashboard/billing",
        icon: CreditCard,
      },
      {
        title: "Settings",
        url: "/settings",
        icon: Settings2,
        items: [
          {
            title: "Profile",
            url: "/settings",
          },
          {
            title: "Security",
            url: "/settings/security",
          },
          {
            title: "Sessions",
            url: "/settings/sessions",
          },
          {
            title: "Change Password",
            url: "/forgot-password",
          },
        ],
      },
      ...(session?.user?.role === ROLES_ENUM.ADMIN ? [
        {
          title: "Admin Panel",
          url: "/admin",
          icon: Shield,
        } as NavMainItem,
      ] : []),
    ],
    projects: [
      {
        title: "Design Engineering",
        url: "#",
        icon: Frame,
      },
      {
        title: "Sales & Marketing",
        url: "#",
        icon: PieChart,
      },
      {
        title: "Travel",
        url: "#",
        icon: Map,
      },
    ],
  };
}
