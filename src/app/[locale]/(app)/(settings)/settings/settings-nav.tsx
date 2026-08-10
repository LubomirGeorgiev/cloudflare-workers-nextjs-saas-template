"use client";

import type { Route } from 'next'
import { Link, usePathname } from "@/i18n/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  User,
  Smartphone,
  Lock,
  Plug
} from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslations } from "next-intl";
import type messages from "@/i18n/messages/en.json";

// Valid label keys under the `Client.Settings.Nav` message namespace, derived from
// the source catalog so this list stays in sync with the translations.
type SettingsNavKey = keyof (typeof messages)["Client"]["Settings"]["Nav"];

interface SettingsNavItem {
  titleKey: SettingsNavKey;
  href: Route;
  icon: React.ComponentType<{ className?: string }>;
}

const settingsNavItems: SettingsNavItem[] = [
  {
    titleKey: "profile",
    href: "/settings",
    icon: User,
  },
  {
    titleKey: "security",
    href: "/settings/security",
    icon: Lock,
  },
  {
    titleKey: "sessions",
    href: "/settings/sessions",
    icon: Smartphone,
  },
  {
    titleKey: "apiMcp",
    href: "/settings/api-mcp",
    icon: Plug,
  },
  {
    titleKey: "changePassword",
    href: "/forgot-password",
    icon: Lock,
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  const isLgAndSmaller = useMediaQuery('LG_AND_SMALLER')
  const t = useTranslations("Client.Settings.Nav");

  const tabs = (
    <Tabs value={pathname}>
      <TabsList className="h-auto p-1">
        {settingsNavItems.map((item) => (
          <TabsTrigger
            key={item.href}
            value={item.href}
            nativeButton={false}
            render={<Link href={item.href} className="flex items-center gap-2" />}
          >
              <item.icon className="h-4 w-4" />
              {t(item.titleKey)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  return (
    <div className="w-full flex items-center gap-4">
      {isLgAndSmaller ? (
        <ScrollArea
          scrollOrientation="horizontal"
          className="min-w-0 flex-1"
        >
          <div className="w-max whitespace-nowrap">{tabs}</div>
        </ScrollArea>
      ) : (
        <div className="min-w-0 flex-1 whitespace-nowrap">{tabs}</div>
      )}
    </div>
  );
}
