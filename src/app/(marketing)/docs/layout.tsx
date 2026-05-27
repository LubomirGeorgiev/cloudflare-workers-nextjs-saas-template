import { redirect } from "next/navigation";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { DocsLlmsTxtLink } from "./_components/docs-llms-txt-link";
import { DocsSearch } from "./_components/docs-search";
import { DocsSidebar } from "./_components/docs-sidebar";
import { MobileDocsNav } from "./_components/mobile-docs-nav";

export default async function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sidebarTree = await getCmsNavigationTree({
    navigationKey: DOCS_SLUG,
  });

  if (sidebarTree.length === 0) {
    redirect("/");
  }

  return (
    <div className="border-t">
      <div className="mx-auto max-w-screen-2xl lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
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

        <div className="min-w-0">
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
          {children}
        </div>
      </div>
    </div>
  );
}
