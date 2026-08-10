import { Suspense } from "react";

import type { Locale } from "@/i18n/config";

import {
  DocsNavigationChrome,
  DocsNavigationChromeFallback,
} from "./_components/docs-navigation-chrome";

export default async function DocsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;

  return (
    <div className="border-t">
      <div className="mx-auto max-w-screen-2xl lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <Suspense fallback={<DocsNavigationChromeFallback />}>
          <DocsNavigationChrome locale={locale} />
        </Suspense>

        <div className="min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
