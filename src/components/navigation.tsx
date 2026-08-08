"use client"

import NextLink from "next/link"
import type { Route } from 'next'
import type { MouseEventHandler } from "react"
import { useTranslations } from "next-intl"
import { ComponentIcon, Menu } from 'lucide-react'
import { Button, buttonVariants } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { useSessionStore } from "@/state/session"
import { cn } from "@/lib/utils"
import { useNavStore } from "@/state/nav"
import { Skeleton } from "@/components/ui/skeleton"
import { SITE_NAME } from "@/constants"
import { DOCS_BASE_PATH } from "@/lib/cms/docs-config"
import { ROLES_ENUM } from "@/app/enums"
import { Link, usePathname } from "@/i18n/navigation"
import LocaleSwitcher from "@/components/locale-switcher"
import { useNavigateAfterClose } from "@/hooks/use-navigate-after-close"

type NavItem = {
  labelKey: "home" | "blog" | "docs" | "settings" | "dashboard" | "adminPanel";
  href: Route;
  // `/settings`, `/dashboard`, `/admin` live outside `[locale]` (app routes) —
  // a locale-prefixed Link would 404 there, so only public routes get one.
  isLocalized: boolean;
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
    return <Skeleton className="h-10 w-[80px] bg-primary" />
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
    { labelKey: "home", href: "/", isLocalized: true },
    ...(hasBlogPosts ? [{ labelKey: "blog", href: "/blog", isLocalized: true }] as NavItem[] : []),
    ...(hasDocsPages ? [{ labelKey: "docs", href: docsPath, isLocalized: true }] as NavItem[] : []),
    // `/settings` and `/dashboard` are app routes outside `[locale]`.
    ...(session ? [
      { labelKey: "settings", href: "/settings", isLocalized: false },
      { labelKey: "dashboard", href: "/dashboard", isLocalized: false },
    ] as NavItem[] : []),
    // `/admin` is also an app route outside `[locale]`.
    ...(isAdmin ? [
      {
        labelKey: "adminPanel",
        href: "/admin",
        isLocalized: false,
      }
    ] as NavItem[] : [])
  ]

  const isActiveLink = (itemHref: string) => {
    if (itemHref === "/") {
      return pathname === "/"
    }
    return pathname === itemHref || pathname.startsWith(`${itemHref}/`)
  }

  return (
    <nav className="dark:bg-muted/30 bg-muted/60 shadow dark:shadow-xl z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link href="/" prefetch={false} className="text-xl md:text-2xl font-bold text-primary flex items-center gap-2 md:gap-3">
              <ComponentIcon className="w-6 h-6 md:w-7 md:h-7" />
              {SITE_NAME}
            </Link>
          </div>
          <div className="hidden md:flex md:items-center md:space-x-6">
            <div className="flex items-baseline space-x-4">
              {isLoading ? (
                <>
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-8 w-16" />
                </>
              ) : (
                navItems.map((item) => {
                  const ItemLink = item.isLocalized ? Link : NextLink
                  return (
                    <ItemLink
                      key={item.href}
                      href={item.href}
                      prefetch={false}
                      className={cn(
                        "text-muted-foreground hover:text-foreground no-underline px-3 h-16 flex items-center text-sm font-medium transition-colors relative",
                        isActiveLink(item.href) && "text-foreground after:absolute after:left-0 after:bottom-0 after:h-0.5 after:w-full after:bg-foreground"
                      )}
                    >
                      {t(item.labelKey)}
                    </ItemLink>
                  )
                })
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
                        {navItems.map((item) => {
                          const ItemLink = item.isLocalized ? Link : NextLink
                          return (
                            <ItemLink
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
                            </ItemLink>
                          )
                        })}
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
        </div>
      </div>
    </nav>
  )
}
