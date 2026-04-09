import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { DocsLlmsTxtLink } from "./_components/docs-llms-txt-link";
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

  return (
    <div className="border-t">
      <div className="mx-auto max-w-screen-2xl lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden border-r py-10 lg:block">
          <div className="sticky top-10 flex max-h-[calc(100vh-5rem)] flex-col">
            <p className="mb-4 px-6 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Documentation
            </p>
            <div className="min-h-0 overflow-y-auto">
              <div className="space-y-1 px-6">
                <DocsLlmsTxtLink />
              </div>
              <DocsSidebar nodes={sidebarTree} />
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <div className="border-b px-4 py-4 lg:hidden">
            <MobileDocsNav nodes={sidebarTree} />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
