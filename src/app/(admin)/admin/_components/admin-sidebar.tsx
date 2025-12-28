"use client"

import { type ComponentType } from "react"
import type { Route } from 'next'
import {
  Users,
  Shield,
  FileText,
  Image,
  Tags,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
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

const adminNavItems: NavMainItem[] = [
  {
    title: "Users",
    url: "/admin",
    icon: Users,
    isActive: true,
  },
  {
    title: "CMS",
    url: "/admin/cms",
    icon: FileText,
    isActive: true,
    items: [
      ...cmsCollectionItems,
      {
        title: "Media Library",
        url: "/admin/cms/media",
        icon: Image,
      },
      {
        title: "Tags",
        url: "/admin/cms/tags",
        icon: Tags,
      },
    ],
  },
]

export function AdminSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
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
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
