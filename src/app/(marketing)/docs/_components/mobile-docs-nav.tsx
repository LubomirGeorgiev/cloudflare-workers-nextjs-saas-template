"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { CmsNavigationTreeNode } from "@/lib/cms/cms-navigation-repository";
import { DocsLlmsTxtLink } from "./docs-llms-txt-link";
import { DocsSidebar } from "./docs-sidebar";

interface MobileDocsNavProps {
  nodes: CmsNavigationTreeNode[];
}

export function MobileDocsNav({ nodes }: MobileDocsNavProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger
        render={<Button variant="outline" size="sm" className="h-11 gap-2 px-4" />}
      >
          <Menu className="size-4" />
          Browse docs
      </SheetTrigger>

      <SheetContent
        side="left"
        className="w-[280px] bg-muted p-0 sm:max-w-[280px]"
      >
        <SheetHeader className="border-b px-4 py-4 text-left">
          <SheetTitle>Documentation</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          <div className="space-y-1 px-4">
            <DocsLlmsTxtLink onNavigate={() => setIsOpen(false)} />
          </div>
          <DocsSidebar
            nodes={nodes}
            className="px-4 pt-1"
            onNavigate={() => setIsOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
