"use client"

import type { Route } from 'next'
import type { MouseEventHandler } from "react"
import { useTranslations } from "next-intl"
import { Menu } from 'lucide-react'
import { Button, buttonVariants } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { useSessionStore } from "@/state/session"
import { cn } from "@/lib/utils"
import { useNavStore } from "@/state/nav"
import { Skeleton } from "@/components/ui/skeleton"
import {
  NavigationActionSkeleton,
  NavigationLinksSkeleton,
  NavigationShell,
} from "@/components/navigation-shell"
import { DOCS_BASE_PATH } from "@/lib/cms/docs-config"
import { ROLES_ENUM } from "@/app/enums"
import { Link, usePathname } from "@/i18n/navigation"
import LocaleSwitcher from "@/components/locale-switcher"
import { useNavigateAfterClose } from "@/hooks/use-navigate-after-close"

type NavItem = {
  labelKey: "home" | "blog" | "docs" | "settings" | "dashboard" | "adminPanel";
  href: Route;
}

interface NavigationProps {
  hasBlogPosts: boolean;
  hasDocsPages: boolean;
}

interface ActionButtonsProps {
  onNavigate?: MouseEventHandler<HTMLAnchorElement>;
}

const ActionButtons = ({ onNavigate }: ActionButtonsProps) => {
  const t = useTranslations("Client.Nav")
  const { session, isLoading } = useSessionStore()

  if (isLoading) {
    return <NavigationActionSkeleton />
  }

  if (session) {
    return null;
  }

  return (
    <Link
      href="/sign-in"
      prefetch={false}
      className={buttonVariants()}
      onClick={onNavigate}
    >
      {t("signIn")}
    </Link>
  )
}

export function Navigation({
  hasBlogPosts,
  hasDocsPages,
}: NavigationProps) {
  const t = useTranslations("Client.Nav")
  const { session, isLoading } = useSessionStore()
  const { isOpen, setIsOpen } = useNavStore()
  const pathname = usePathname()
  const { onNavigate, onOpenChangeComplete } = useNavigateAfterClose(() => setIsOpen(false))
  const isAdmin = session?.user?.role === ROLES_ENUM.ADMIN

  const docsPath = DOCS_BASE_PATH as Route

  const navItems: NavItem[] = [
    { labelKey: "home", href: "/" },
    ...(hasBlogPosts ? [{ labelKey: "blog", href: "/blog" }] as NavItem[] : []),
    ...(hasDocsPages ? [{ labelKey: "docs", href: docsPath }] as NavItem[] : []),
    ...(session ? [
      { labelKey: "settings", href: "/settings" },
      { labelKey: "dashboard", href: "/dashboard" },
    ] as NavItem[] : []),
    ...(isAdmin ? [{ labelKey: "adminPanel", href: "/admin" }] as NavItem[] : [])
  ]

  const isActiveLink = (itemHref: string) => {
    if (itemHref === "/") {
      return pathname === "/"
    }
    return pathname === itemHref || pathname.startsWith(`${itemHref}/`)
  }

  return (
    <NavigationShell>
      <div className="hidden md:flex md:items-center md:space-x-6">
        <div className="flex items-baseline space-x-4">
          {isLoading ? (
            <NavigationLinksSkeleton />
          ) : (
            navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  className={cn(
                    "text-muted-foreground hover:text-foreground no-underline px-3 h-16 flex items-center text-sm font-medium transition-colors relative",
                    isActiveLink(item.href) && "text-foreground after:absolute after:left-0 after:bottom-0 after:h-0.5 after:w-full after:bg-foreground"
                  )}
                >
                  {t(item.labelKey)}
                </Link>
            ))
          )}
        </div>
        <LocaleSwitcher />
        <ActionButtons />
      </div>
      <div className="md:hidden flex items-center">
        <Sheet
          open={isOpen}
          onOpenChange={setIsOpen}
          onOpenChangeComplete={onOpenChangeComplete}
        >
          <SheetTrigger
            render={<Button variant="ghost" size="icon" className="p-6" />}
          >
              <Menu className="w-9 h-9" />
              <span className="sr-only">{t("openMenu")}</span>
          </SheetTrigger>
          <SheetContent side="right" className="w-[240px] sm:w-[300px]">
            <div className="mt-6 flow-root">
              <div className="space-y-2">
                {isLoading ? (
                  <>
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </>
                ) : (
                  <>
                    {navItems.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          prefetch={false}
                          className={cn(
                            "block px-3 py-2 text-base font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 no-underline transition-colors relative",
                            isActiveLink(item.href) && "text-foreground"
                          )}
                          onClick={onNavigate}
                        >
                          {t(item.labelKey)}
                        </Link>
                    ))}
                    <div className="flex items-center gap-3 px-3 pt-4">
                      <LocaleSwitcher />
                      <ActionButtons onNavigate={onNavigate} />
                    </div>
                  </>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </NavigationShell>
  )
}
