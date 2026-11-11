"use client"

import { type ComponentType } from "react"
import type { Route } from 'next'
import { Bug, Building2, CalendarClock, FileText, Image, PanelLeft, Plug, Shield, ShieldOff, Tags, Terminal, Users, Zap } from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { getSidebarBillingUrl } from "@/components/app-sidebar-data"
import { useSessionStore } from "@/state/session"
import type { SessionValidationResult } from "@/types"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarGroup,
} from "@/components/ui/sidebar"
import { cmsConfig } from "@/../cms.config"
import { getCmsNavigations } from "@/lib/cms/cms-navigation-config"

type NavItem = {
  title: string
  url: Route
  icon?: ComponentType
}

type NavMainItem = NavItem & {
  isActive?: boolean
  items?: NavItem[]
}

// Dynamically generate CMS collection nav items
const cmsCollectionItems: NavItem[] = Object.entries(cmsConfig.collections).map(
  ([slug, collection]) => ({
    title: collection.labels.plural,
    url: `/admin/cms/${slug}` as Route,
    icon: FileText,
  })
);

const cmsNavigationItems: NavItem[] = getCmsNavigations().map((navigation) => ({
  title: navigation.label,
  url: `/admin/cms/navigation/${navigation.navigationKey}` as Route,
  icon: PanelLeft,
}));

const adminNavItems: NavMainItem[] = [
  {
    title: "Users",
    url: "/admin",
    icon: Users,
    isActive: true,
  },
  {
    title: "Teams",
    url: "/admin/teams",
    icon: Building2,
  },
  {
    title: "Blocked emails",
    url: "/admin/blocked-emails",
    icon: ShieldOff,
  },
  {
    title: "Debug",
    url: "/admin/debug",
    icon: Bug,
  },
  {
    title: "Scheduled Jobs",
    url: "/admin/jobs",
    icon: CalendarClock,
  },
  {
    title: "System",
    url: "/admin/system",
    icon: Zap,
  },
  {
    title: "OAuth apps",
    url: "/admin/oauth-apps",
    icon: Plug,
  },
  {
    title: "Internal API",
    url: "/admin/api",
    icon: Terminal,
  },
  {
    title: "CMS",
    url: "/admin/cms",
    icon: FileText,
    isActive: true,
    items: [
      {
        title: "Overview",
        url: "/admin/cms",
        icon: FileText,
      },
      ...cmsCollectionItems,
      {
        title: "Media Library",
        url: "/admin/cms/media",
        icon: Image,
      },
      ...cmsNavigationItems,
      {
        title: "Tags",
        url: "/admin/cms/tags",
        icon: Tags,
      },
    ],
  },
]

export function AdminSidebar({
  serverSession,
  billingEnabled,
  ...props
}: AdminSidebarProps) {
  const clientSession = useSessionStore((store) => store.session)
  const session = clientSession ?? serverSession
  // Admin routes have no `[teamSlug]`, so the selected team decides the path.
  const billingUrl = getSidebarBillingUrl({ session, billingEnabled })

  return (
    <Sidebar
      collapsible="icon"
      role="navigation"
      aria-label="Admin navigation"
      {...props}
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="pointer-events-none"
                tooltip="Admin Panel"
              >
                <Shield size={24} />
                <span className="text-lg font-bold">Admin Panel</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <NavMain items={adminNavItems} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser session={session} billingUrl={billingUrl} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

interface AdminSidebarProps extends React.ComponentProps<typeof Sidebar> {
  serverSession: SessionValidationResult;
  // Server-evaluated isBillingEnabled() from @/flags, the same value the app sidebar gets.
  billingEnabled: boolean;
}
