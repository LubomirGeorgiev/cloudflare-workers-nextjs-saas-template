import "server-only";

import { getLocale, getTranslations } from "next-intl/server";

import { Skeleton } from "@/components/ui/skeleton";
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { redirect } from "@/i18n/navigation";

import { DocsLlmsTxtLink } from "./docs-llms-txt-link";
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
        <div className="sticky top-10 flex max-h-[calc(100vh-5rem)] flex-col">
          <p className="mb-4 px-6 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t("heading")}
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
        <div className="sticky top-10 flex max-h-[calc(100vh-5rem)] flex-col">
          <Skeleton className="mb-4 ml-6 h-3 w-28" />
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
