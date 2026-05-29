import "server-only";

import { redirect } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { DOCS_SLUG } from "@/lib/cms/docs-config";

import { DocsLlmsTxtLink } from "./docs-llms-txt-link";
import { DocsSearch } from "./docs-search";
import { DocsSidebar } from "./docs-sidebar";
import { MobileDocsNav } from "./mobile-docs-nav";

export async function DocsNavigationChrome() {
  const sidebarTree = await getCmsNavigationTree({
    navigationKey: DOCS_SLUG,
  });

  if (sidebarTree.length === 0) {
    redirect("/");
  }

  return (
    <>
      <aside className="hidden border-r bg-muted/20 py-10 lg:block">
        <div className="sticky top-10 flex max-h-[calc(100vh-5rem)] flex-col">
          <p className="mb-4 px-6 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Documentation
          </p>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <div className="space-y-3 px-3">
              <DocsSearch registerHotkeys />
              <DocsLlmsTxtLink />
            </div>
            <DocsSidebar nodes={sidebarTree} />
          </div>
        </div>
      </aside>

      <div className="border-b px-4 py-4 lg:hidden">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Documentation
          </p>
          <div className="flex items-center gap-3">
            <DocsSearch className="h-11 flex-1 justify-start" />
            <MobileDocsNav nodes={sidebarTree} />
          </div>
        </div>
      </div>
    </>
  );
}

export function DocsNavigationChromeFallback() {
  return (
    <>
      <aside className="hidden border-r bg-muted/20 py-10 lg:block">
        <div className="sticky top-10 flex max-h-[calc(100vh-5rem)] flex-col">
          <p className="mb-4 px-6 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Documentation
          </p>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <div className="space-y-3 px-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-3 px-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-11/12" />
              <Skeleton className="h-8 w-10/12" />
              <Skeleton className="h-8 w-9/12" />
            </div>
          </div>
        </div>
      </aside>

      <div className="border-b px-4 py-4 lg:hidden">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Documentation
          </p>
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 flex-1" />
            <Skeleton className="h-11 w-32" />
          </div>
        </div>
      </div>
    </>
  );
}
