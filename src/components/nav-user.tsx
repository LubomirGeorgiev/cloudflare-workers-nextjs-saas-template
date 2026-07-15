"use client"

import {
  BadgeCheck,
  Bell,
  Check,
  ChevronsUpDown,
  CreditCard,
  Globe,
  LogOut,
  Moon,
  Sun,
  Monitor,
} from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { useTheme } from "next-themes"
import { useLocale, useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { ENABLED_LOCALES, LOCALE_LABELS } from "@/i18n/config"
import { LocaleFlag } from "@/components/locale-flag"
import { useChangeLocale } from "@/hooks/useChangeLocale"
import type { SessionValidationResult } from "@/types"

interface NavUserProps {
  session?: SessionValidationResult | null;
}

export function NavUser({ session: sessionProp }: NavUserProps) {
  const { session: storeSession, isLoading } = useSessionStore();
  const session = storeSession ?? sessionProp ?? null;
  const { signOut } = useSignOut();
  const { isMobile, setOpenMobile } = useSidebar()
  const router = useRouter()
  const { setTheme } = useTheme()
  const activeLocale = useLocale()
  const { changeLocale } = useChangeLocale()
  const t = useTranslations("Client.Sidebar.user")
  const tTheme = useTranslations("Client.ThemeSwitch")

  if (isLoading && !session) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground h-14"
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
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground h-14"
              />
            }
          >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.avatar ?? ''} alt={displayName ?? ''} />
                <AvatarFallback className="rounded-lg">CN</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 gap-0.5 text-left text-sm leading-tight">
                <span className="font-semibold overflow-hidden text-ellipsis whitespace-nowrap">{displayName}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[var(--anchor-width)] min-w-56 rounded-lg"
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
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem className="cursor-pointer" onClick={() => {
                setOpenMobile(false)
                router.push('/settings')
              }}>
                <BadgeCheck />
                {t("account")}
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onClick={() => {
                setOpenMobile(false)
                router.push('/dashboard/billing')
              }}>
                <CreditCard />
                {t("billing")}
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer">
                <Bell />
                {t("notifications")}
              </DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Sun className="h-4 w-4" />
                {t("changeTheme")}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={() => setTheme("system")}>
                    <Monitor className="h-4 w-4" />
                    {tTheme("system")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("light")}>
                    <Sun className="h-4 w-4" />
                    {tTheme("light")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("dark")}>
                    <Moon className="h-4 w-4" />
                    {tTheme("dark")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>

            {ENABLED_LOCALES.length > 1 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Globe className="h-4 w-4" />
                  {t("changeLanguage")}
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    {ENABLED_LOCALES.map((locale) => (
                      <DropdownMenuItem
                        key={locale}
                        onClick={() => changeLocale(locale)}
                        className="justify-between gap-4"
                      >
                        <span className="flex items-center gap-2">
                          <LocaleFlag locale={locale} />
                          {LOCALE_LABELS[locale]}
                        </span>
                        <Check
                          className={cn(
                            "h-4 w-4",
                            locale === activeLocale ? "opacity-100" : "opacity-0"
                          )}
                        />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => {
                setOpenMobile(false)
                void signOut()
              }}
              className="cursor-pointer text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400"
            >
              <LogOut />
              {t("logOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
