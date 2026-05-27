import { Footer } from '@/components/footer';
import { Navigation } from '@/components/navigation';
import { getCmsCollectionCount } from '@/lib/cms/cms-repository';
import { getCmsNavigationRootPath } from '@/lib/cms/cms-navigation-repository';
import { DOCS_SLUG } from '@/lib/cms/docs-config';

export default async function NavFooterLayout({
  children,
  renderFooter = true,
}: Readonly<{
  children: React.ReactNode;
  renderFooter?: boolean;
}>) {
  const [blogPostCount, docsRootPath] = await Promise.all([
    getCmsCollectionCount({
      collectionSlug: "blog",
      status: "published",
    }),
    getCmsNavigationRootPath({
      navigationKey: DOCS_SLUG,
    }),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation
        hasBlogPosts={blogPostCount > 0}
        hasDocsPages={Boolean(docsRootPath)}
      />
      <main className="flex-1">
        {children}
      </main>
      {renderFooter && <Footer />}
    </div>
  );
}
