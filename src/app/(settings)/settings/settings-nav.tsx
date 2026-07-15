"use client";

import type { Route } from 'next'
import Link from "next/link";
import { Link as LocaleLink } from "@/i18n/navigation";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  User,
  Smartphone,
  Lock,
  LogOut
} from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRef } from "react";
import useSignOut from "@/hooks/useSignOut";
import { useTranslations } from "next-intl";
import type messages from "@/i18n/messages/en.json";

// Valid label keys under the `Client.Settings.Nav` message namespace, derived from
// the source catalog so this list stays in sync with the translations.
type SettingsNavKey = keyof (typeof messages)["Client"]["Settings"]["Nav"];

interface SettingsNavItem {
  titleKey: SettingsNavKey;
  href: Route;
  icon: React.ComponentType<{ className?: string }>;
  // True for destinations under `app/[locale]` (e.g. /forgot-password), which
  // need the locale-prefixing Link; /settings/* routes are unprefixed.
  isLocalizedRoute?: boolean;
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
    titleKey: "changePassword",
    href: "/forgot-password",
    icon: Lock,
    isLocalizedRoute: true,
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  const isLgAndSmaller = useMediaQuery('LG_AND_SMALLER')
  const dialogCloseRef = useRef<HTMLButtonElement>(null);
  const { signOut } = useSignOut();
  const t = useTranslations("Client.Settings.Nav");
  const tCommon = useTranslations("Client.Common");

  const tabs = (
    <Tabs value={pathname}>
      <TabsList className="h-auto p-1">
        {settingsNavItems.map((item) => (
          <TabsTrigger
            key={item.href}
            value={item.href}
            nativeButton={false}
            render={
              item.isLocalizedRoute
                ? <LocaleLink href={item.href} className="flex items-center gap-2" />
                : <Link href={item.href} className="flex items-center gap-2" />
            }
          >
              <item.icon className="h-4 w-4" />
              {t(item.titleKey)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  return (
    <div className="w-full flex items-center justify-between gap-4">
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

      <Dialog>
        <DialogTrigger
          render={
            <button
              type="button"
              className={cn(
                buttonVariants({ variant: "destructive" }),
                "justify-start hover:no-underline whitespace-nowrap bg-red-700/25 hover:bg-red-600/40"
              )}
            />
          }
        >
            <LogOut className="mr-2 h-4 w-4" />
            {t("signOut")}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("signOutConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("signOutConfirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex flex-col gap-4">
            <DialogClose
              ref={dialogCloseRef}
              render={<Button variant="outline" />}
            >
              {tCommon("cancel")}
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                signOut();
                dialogCloseRef.current?.click();
              }}
            >
              {t("signOut")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
