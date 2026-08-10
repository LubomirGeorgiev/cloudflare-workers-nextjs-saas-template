"use client";

// Client component on purpose: a Suspense fallback must not suspend, and resolving its one string
// on the server would force `NavFooterLayout` to be async. `useTranslations` reads the locale from
// NextIntlClientProvider, so it neither suspends nor touches `headers()`.
import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  NavigationActionSkeleton,
  NavigationLinksSkeleton,
  NavigationShell,
} from "@/components/navigation-shell";

export function NavigationWithCmsLinksFallback() {
  const tNav = useTranslations("Client.Nav");

  return (
    <NavigationShell>
      <div className="hidden md:flex md:items-center md:space-x-6">
        <div className="flex items-baseline space-x-4">
          <NavigationLinksSkeleton />
        </div>
        <NavigationActionSkeleton />
      </div>

      <div className="md:hidden flex items-center">
        <div className="inline-flex size-12 items-center justify-center rounded-md">
          <Menu className="w-9 h-9" />
          <span className="sr-only">{tNav("loadingMenu")}</span>
        </div>
      </div>
    </NavigationShell>
  );
}
