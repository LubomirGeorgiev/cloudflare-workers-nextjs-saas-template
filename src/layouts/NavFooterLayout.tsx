import { Footer } from '@/components/footer';
import { NavigationWithCmsLinksFallback } from '@/components/navigation-with-cms-links-fallback';
import { NavigationWithCmsLinks } from '@/components/navigation-with-cms-links';
import type { Locale } from "@/i18n/config";
import { Suspense } from 'react';

export default function NavFooterLayout({
  children,
  params,
  renderFooter = true,
}: Readonly<{
  children: React.ReactNode;
  // Threaded from the route's `params` so the footer never calls `getLocale()`, which would read
  // `headers()` and make every marketing page dynamic. Passed on unawaited so no layout above the
  // footer has to be async.
  params: Promise<{ locale: Locale }>;
  renderFooter?: boolean;
}>) {
  return (
    <div className="min-h-screen flex flex-col">
      <Suspense fallback={<NavigationWithCmsLinksFallback />}>
        <NavigationWithCmsLinks />
      </Suspense>
      <main className="flex-1">
        {children}
      </main>
      {renderFooter && <Footer params={params} />}
    </div>
  );
}
