import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { DocsSidebar } from "./_components/docs-sidebar";

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
        <aside className="hidden border-r px-6 py-10 lg:block">
          <div className="sticky top-10">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Documentation
            </p>
            <DocsSidebar nodes={sidebarTree} />
          </div>
        </aside>

        <div className="min-w-0">
          <div className="border-b px-4 py-4 lg:hidden">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Documentation
            </p>
            <DocsSidebar nodes={sidebarTree} className="max-h-72 overflow-y-auto" />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
