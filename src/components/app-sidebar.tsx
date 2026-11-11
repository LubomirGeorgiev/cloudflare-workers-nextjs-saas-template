"use client"

import { NavMain } from "@/components/nav-main"
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
import { useParams } from "next/navigation"
import { useSessionStore } from "@/state/session"
import type { SessionValidationResult } from "@/types"

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  serverSession?: SessionValidationResult;
  billingEnabled?: boolean;
}

export function AppSidebar({
  serverSession,
  billingEnabled,
  ...props
}: AppSidebarProps) {
  const clientSession = useSessionStore((store) => store.session);
  const session = clientSession ?? serverSession ?? null;
  // Vinext returns null outside a route match, though the Next types do not admit it.
  const teamSlug = useParams<{ teamSlug?: string }>()?.teamSlug;
  const data = getAppSidebarData({ session, billingEnabled, teamSlug });

  return (
    <Sidebar collapsible="icon" {...props}>
      {data?.teams?.length > 0 && (
        <SidebarHeader>
          <TeamSwitcher teams={data.teams} activeTeamId={data.activeTeamId} teamSlug={teamSlug} />
        </SidebarHeader>
      )}

      <SidebarContent>
        <NavMain items={data.navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser session={session} billingUrl={data.billingUrl} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
