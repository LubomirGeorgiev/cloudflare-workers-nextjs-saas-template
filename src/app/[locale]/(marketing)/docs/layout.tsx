import { Suspense } from "react";

import {
  DocsNavigationChrome,
  DocsNavigationChromeFallback,
} from "./_components/docs-navigation-chrome";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="border-t">
      <div className="mx-auto max-w-screen-2xl lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <Suspense fallback={<DocsNavigationChromeFallback />}>
          <DocsNavigationChrome />
        </Suspense>

        <div className="min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
