"use client"

import { useCallback, useMemo, type ElementType } from "react"
import { Building2, ChevronsUpDown, Plus } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import Link from "next/link"
import { useSessionStore } from "@/state/session"
import { useServerAction } from "zsa-react"
import { updateSelectedTeamAction } from "@/actions/session.action"
import { toast } from "sonner"

export function TeamSwitcher({
  teams,
}: {
  teams: {
    id: string
    name: string
    logo: ElementType
    role: string
  }[]
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  const session = useSessionStore()
  const selectedTeamId = session.selectedTeam()
  const setSelectedTeam = session.setSelectedTeam

  const { execute: updateSelectedTeam, isPending } = useServerAction(updateSelectedTeamAction, {
    onError: (error) => {
      console.error("Failed to update selected team:", error);
      // Revert optimistic update
      setSelectedTeam(selectedTeamId);
      toast.error("Failed to update selected team");
    },
  })

  // Find the active team based on selectedTeamId from session
  const activeTeam = useMemo(() => {
    if (!selectedTeamId) return teams[0] || null

    // Find the matching team in the props by ID
    return teams.find(t => t.id === selectedTeamId) || teams[0] || null
  }, [selectedTeamId, teams])

  const LogoComponent = activeTeam?.logo || Building2

  const handleTeamChange = useCallback((team: typeof teams[0]) => {
    // Optimistically update local state
    setSelectedTeam(team.id)

    // Call server action to persist
    // Error handling is done via onError callback in useServerAction
    updateSelectedTeam({ selectedTeam: team.id })
  }, [setSelectedTeam, updateSelectedTeam])

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <LogoComponent className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {activeTeam?.name || "No Team"}
                </span>
                <span className="truncate text-xs capitalize">{activeTeam?.role || "Member"}</span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Teams
            </DropdownMenuLabel>
            {teams.length > 0 ? (
              teams.map((team, index) => (
                <DropdownMenuItem
                  key={team.id}
                  onClick={() => handleTeamChange(team)}
                  className="gap-2 p-2"
                  disabled={isPending}
                >
                  <div className="flex size-6 items-center justify-center rounded-sm border">
                    <team.logo className="size-4 shrink-0" />
                  </div>
                  {team.name}
                  <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled className="gap-2 p-2">
                <div className="flex size-6 items-center justify-center rounded-sm border">
                  <Building2 className="size-4 shrink-0" />
                </div>
                No teams available
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2 cursor-pointer" asChild>
              <Link
                href="/dashboard/teams/create"
                onClick={() => setOpenMobile(false)}
              >
                <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                  <Plus className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">Add team</div>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
