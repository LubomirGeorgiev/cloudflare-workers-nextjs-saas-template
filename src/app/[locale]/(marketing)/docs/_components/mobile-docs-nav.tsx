"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { CmsNavigationTreeNode } from "@/lib/cms/cms-navigation-repository";
import { DocsRouteLinks } from "./docs-guide-links";
import { DocsSidebar } from "./docs-sidebar";

interface MobileDocsNavProps {
  nodes: CmsNavigationTreeNode[];
}

export function MobileDocsNav({ nodes }: MobileDocsNavProps) {
  const t = useTranslations("Client.Docs.Navigation");
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger
        render={<Button variant="outline" size="sm" className="h-11 gap-2 px-4" />}
      >
          <Menu className="size-4" />
          {t("browseDocs")}
      </SheetTrigger>

      <SheetContent
        side="left"
        className="w-70 bg-muted p-0 sm:max-w-70"
      >
        <SheetHeader className="border-b px-4 py-4 text-left">
          <SheetTitle>{t("heading")}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          {/* Guides first, then the static reference and machine surfaces. */}
          <DocsSidebar
            nodes={nodes}
            className="px-4"
            onNavigate={() => setIsOpen(false)}
          />
          <div className="mt-4 space-y-1 border-t px-4 pt-4">
            <DocsRouteLinks onNavigate={() => setIsOpen(false)} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
