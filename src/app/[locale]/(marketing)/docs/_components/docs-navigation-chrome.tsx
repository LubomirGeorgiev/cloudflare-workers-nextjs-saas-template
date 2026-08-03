import "server-only";

import { getLocale, getTranslations } from "next-intl/server";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { redirect } from "@/i18n/navigation";

import { DocsRouteLinks } from "./docs-guide-links";
import { DocsSearch } from "./docs-search";
import { DocsSidebar } from "./docs-sidebar";
import { MobileDocsNav } from "./mobile-docs-nav";

export async function DocsNavigationChrome() {
  const t = await getTranslations("Client.Docs.Navigation");
  const locale = await getLocale();
  // Locale-scoped tree: PAGE nodes untranslated in the active locale are
  // pruned out by `getCmsNavigationTree` (see cms-navigation-repository.ts),
  // so the sidebar naturally shows only translated entries for that locale.
  const sidebarTree = await getCmsNavigationTree({
    navigationKey: DOCS_SLUG,
    locale,
  });

  if (sidebarTree.length === 0) {
    redirect({ href: "/", locale });
  }

  return (
    <>
      <aside className="hidden border-r bg-muted/20 py-10 lg:block">
        {/* Definite height, not max-height: the ScrollArea viewport is `h-full`, which only
            resolves against a flex parent whose own height is definite. */}
        <div className="sticky top-10 flex h-[calc(100vh-5rem)] flex-col">
          <p className="mb-4 px-6 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t("heading")}
          </p>
          <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade-y">
            <div className="flex flex-col gap-3">
              <div className="px-3">
                <DocsSearch registerHotkeys />
              </div>
              {/* Guides first, then the static reference and machine surfaces. */}
              <DocsSidebar nodes={sidebarTree} />
              <div className="space-y-3 border-t px-3 pt-3">
                <DocsRouteLinks />
              </div>
            </div>
          </ScrollArea>
        </div>
      </aside>

      <div className="border-b px-4 py-4 lg:hidden">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t("heading")}
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
  // Kept synchronous (no getTranslations) because this is used directly as a
  // <Suspense fallback> element, which must resolve without awaiting a promise.
  // Omit the heading text — skeletons only — so we don't flash English copy
  // on non-default locales.
  return (
    <>
      <aside className="hidden border-r bg-muted/20 py-10 lg:block">
        {/* Definite height, not max-height: the ScrollArea viewport is `h-full`, which only
            resolves against a flex parent whose own height is definite. */}
        <div className="sticky top-10 flex h-[calc(100vh-5rem)] flex-col">
          <Skeleton className="mb-4 ml-6 h-3 w-28" />
          <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade-y">
            <div className="flex flex-col gap-3">
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
          </ScrollArea>
        </div>
      </aside>

      <div className="border-b px-4 py-4 lg:hidden">
        <div className="space-y-3">
          <Skeleton className="h-3 w-28" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 flex-1" />
            <Skeleton className="h-11 w-32" />
          </div>
        </div>
      </div>
    </>
  );
}
