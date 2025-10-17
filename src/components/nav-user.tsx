"use client"

import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  CreditCard,
  LogOut,
} from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import useSignOut from "@/hooks/useSignOut"
import { useRouter } from "next/navigation"
import { useSessionStore } from "@/state/session"
import ThemeSwitch from "./theme-switch"

export function NavUser() {
  const { session, isLoading } = useSessionStore();
  const { signOut } = useSignOut();
  const { isMobile, setOpenMobile } = useSidebar()
  const router = useRouter()

  if (isLoading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground h-14"
          >
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="grid flex-1 gap-0.5 text-left text-sm leading-tight">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-4 w-4 ml-auto" />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  if (!session?.user) {
    return null;
  }

  const { user } = session;
  const displayName = user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.email;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground h-14"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.avatar ?? ''} alt={displayName ?? ''} />
                <AvatarFallback className="rounded-lg">CN</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 gap-0.5 text-left text-sm leading-tight">
                <span className="font-semibold overflow-hidden text-ellipsis whitespace-nowrap">{displayName}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                <Badge variant="secondary" className="w-fit text-[10px]" onClick={() => {
                  setOpenMobile(false)
                  router.push('/dashboard/billing')
                }}>
                  {user.currentCredits} credits
                </Badge>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user.avatar ?? ''} alt={displayName ?? ''} />
                  <AvatarFallback className="rounded-lg">CN</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 gap-0.5 text-left text-sm leading-tight">
                  <span className="font-semibold">{displayName}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                  <Badge variant="secondary" className="w-fit text-[10px]">
                    {user.currentCredits} credits
                  </Badge>
                </div>
              </div>
            </DropdownMenuLabel>
            <div className="px-2">
              <ThemeSwitch className="w-full my-3">
                Change theme
              </ThemeSwitch>
            </div>
            <DropdownMenuGroup>
              <DropdownMenuItem className="cursor-pointer" onClick={() => {
                setOpenMobile(false)
                router.push('/settings')
              }}>
                <BadgeCheck />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onClick={() => {
                setOpenMobile(false)
                router.push('/dashboard/billing')
              }}>
                <CreditCard />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer">
                <Bell />
                Notifications
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setOpenMobile(false)
                signOut().then(() => {
                  router.push('/')
                })
              }}
              className="cursor-pointer"
            >
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
