"use client"

import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  getAppSidebarData,
} from "@/components/app-sidebar-data"
import { useSessionStore } from "@/state/session"
import type { SessionValidationResult } from "@/types"

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  serverSession?: SessionValidationResult;
}

export function AppSidebar({
  serverSession,
  ...props
}: AppSidebarProps) {
  const clientSession = useSessionStore((store) => store.session);
  const session = clientSession ?? serverSession ?? null;
  const data = getAppSidebarData({ session });

  return (
    <Sidebar collapsible="icon" {...props}>
      {data?.teams?.length > 0 && (
        <SidebarHeader>
          <TeamSwitcher teams={data.teams} />
        </SidebarHeader>
      )}

      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavProjects projects={data.projects} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser session={session} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
