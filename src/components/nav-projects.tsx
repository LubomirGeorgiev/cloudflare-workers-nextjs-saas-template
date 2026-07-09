"use client"

import {
  Folder,
  Forward,
  MoreHorizontal,
  Trash2,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useTranslations } from "next-intl"
import type { NavItem } from "./app-sidebar-data"

type Props = {
  projects: NavItem[]
}

export function NavProjects({
  projects,
}: Props) {
  const { isMobile, setOpenMobile } = useSidebar()
  const t = useTranslations("Client.Sidebar")

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{t("groups.projects")}</SidebarGroupLabel>
      <SidebarMenu>
        {projects.map((item) => {
          const itemLabel = item.titleKey ? t(`nav.${item.titleKey}`) : item.title

          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                render={
                  <a
                    href={item.url}
                    onClick={() => setOpenMobile(false)}
                  />
                }
              >
                  {item?.icon && <item.icon />}
                  <span>{itemLabel}</span>
              </SidebarMenuButton>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<SidebarMenuAction showOnHover />}
                >
                    <MoreHorizontal />
                    <span className="sr-only">{t("projects.more")}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-48 rounded-lg"
                  side={isMobile ? "bottom" : "right"}
                  align={isMobile ? "end" : "start"}
                >
                  <DropdownMenuItem>
                    <Folder className="text-muted-foreground" />
                    <span>{t("projects.view")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Forward className="text-muted-foreground" />
                    <span>{t("projects.share")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <Trash2 className="text-muted-foreground" />
                    <span>{t("projects.delete")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          )
        })}
        <SidebarMenuItem>
          <SidebarMenuButton className="text-sidebar-foreground/70">
            <MoreHorizontal className="text-sidebar-foreground/70" />
            <span>{t("projects.more")}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
