"use client"

import { useCallback, type ElementType } from "react"
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
import { Link, usePathname, useRouter } from "@/i18n/navigation"
import { useSessionStore } from "@/state/session"
import { useAction } from "next-safe-action/hooks"
import { updateSelectedTeamAction } from "@/actions/session.action"
import { toast } from "sonner"
import { useTranslations } from "@/i18n/client"
import { formatSessionTeamRoleLabel, type SessionTeamRole } from "@/lib/teams/team-role-labels"
import { getSwitchedTeamPath } from "@/utils/active-team"

export function TeamSwitcher({
  teams,
  activeTeamId,
  teamSlug,
}: {
  teams: {
    id: string
    slug: string
    name: string
    logo: ElementType
    role: SessionTeamRole
  }[]
  activeTeamId?: string
  // The `[teamSlug]` route param of the current page, if any.
  teamSlug?: string
}) {
  const t = useTranslations("Client.Dashboard.Teams")
  const router = useRouter()
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  const selectedTeamId = useSessionStore((store) => store.session?.selectedTeam)
  const setSelectedTeam = useSessionStore((store) => store.setSelectedTeam)

  const { execute: updateSelectedTeam, isExecuting } = useAction(updateSelectedTeamAction, {
    onError: ({ error }) => {
      console.error("Failed to update selected team:", error);
      // Revert optimistic update
      setSelectedTeam(selectedTeamId);
      toast.error(error.serverError?.message || t("toastUpdateSelectedTeamError"));
    },
    // Server components off a team URL read the team from the KV session, so the store alone leaves
    // them on the old team. Refresh from onSuccess, not handleTeamChange, so the KV write lands first.
    onSuccess: () => {
      if (!teamSlug) {
        router.refresh()
      }
    },
  })

  // Comes from props: the server render has an empty store, so a store read mismatches on hydration.
  const activeTeam = teams.find((team) => team.id === activeTeamId) ?? null

  const LogoComponent = activeTeam?.logo || Building2

  const handleTeamChange = useCallback((team: typeof teams[0]) => {
    // Optimistically update local state
    setSelectedTeam(team.id)

    // Call server action to persist
    // Error handling is done via the useAction onError callback
    updateSelectedTeam({ selectedTeam: team.id })

    // A team page takes its team from the URL, so open the same section of the next team.
    if (teamSlug && team.slug !== teamSlug) {
      setOpenMobile(false)
      router.push(getSwitchedTeamPath({ pathname, currentTeamSlug: teamSlug, nextTeamSlug: team.slug }))
    }
  }, [pathname, router, setOpenMobile, setSelectedTeam, teamSlug, updateSelectedTeam])

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <LogoComponent className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {activeTeam?.name || t("switcherNoTeam")}
                </span>
                <span className="truncate text-xs">
                  {activeTeam ? formatSessionTeamRoleLabel({ role: activeTeam.role, translate: t }) : t("memberRole")}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[var(--anchor-width)] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t("switcherTeamsLabel")}
            </DropdownMenuLabel>
            {teams.length > 0 ? (
              teams.map((team, index) => (
                <DropdownMenuItem
                  key={team.id}
                  onClick={() => handleTeamChange(team)}
                  className="gap-2 p-2"
                  disabled={isExecuting}
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
                {t("switcherNoTeams")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 p-2 cursor-pointer"
              render={
                <Link
                  href="/dashboard/teams/create"
                  prefetch={false}
                  onClick={() => setOpenMobile(false)}
                />
              }
            >
                <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                  <Plus className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">{t("switcherAddTeam")}</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
