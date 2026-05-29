import { Footer } from '@/components/footer';
import {
  NavigationWithCmsLinks,
  NavigationWithCmsLinksFallback,
} from '@/components/navigation-with-cms-links';
import { Suspense } from 'react';

export default function NavFooterLayout({
  children,
  renderFooter = true,
}: Readonly<{
  children: React.ReactNode;
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
      {renderFooter && <Footer />}
    </div>
  );
}
