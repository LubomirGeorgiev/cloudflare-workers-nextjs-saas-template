"use client";

import type { Route } from 'next'
import Link from "next/link";
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

interface SettingsNavItem {
  title: string;
  href: Route;
  icon: React.ComponentType<{ className?: string }>;
}

const settingsNavItems: SettingsNavItem[] = [
  {
    title: "Profile",
    href: "/settings",
    icon: User,
  },
  {
    title: "Security",
    href: "/settings/security",
    icon: Lock,
  },
  {
    title: "Sessions",
    href: "/settings/sessions",
    icon: Smartphone,
  },
  {
    title: "Change Password",
    href: "/forgot-password",
    icon: Lock,
  },
];

export function SettingsNav() {
  const pathname = usePathname();
  const isLgAndSmaller = useMediaQuery('LG_AND_SMALLER')
  const dialogCloseRef = useRef<HTMLButtonElement>(null);
  const { signOut } = useSignOut();

  const tabs = (
    <Tabs value={pathname}>
      <TabsList className="h-auto p-1">
        {settingsNavItems.map((item) => (
          <TabsTrigger key={item.href} value={item.href} asChild>
            <Link href={item.href} className="flex items-center gap-2">
              <item.icon className="h-4 w-4" />
              {item.title}
            </Link>
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
        <DialogTrigger asChild>
          <button
            className={cn(
              buttonVariants({ variant: "destructive" }),
              "justify-start hover:no-underline whitespace-nowrap bg-red-700/25 hover:bg-red-600/40"
            )}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
            <DialogDescription>
              Are you sure you want to sign out of your account?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex flex-col gap-4">
            <DialogClose ref={dialogCloseRef} asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                signOut();
                dialogCloseRef.current?.click();
              }}
            >
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
