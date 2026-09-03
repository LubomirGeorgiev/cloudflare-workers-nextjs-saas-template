import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { RootShell } from "@/components/root-shell";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { routing } from "@/i18n/routing";
import { buildSiteOpenGraph } from "@/utils/i18n-metadata";
import { buildRootMetadata } from "@/utils/root-metadata";

// The one and only root layout; `app/layout.tsx` intentionally does not exist, because a layout
// above this one runs before the locale is known, so it could not set `<html lang>` from the URL
// segment and would have to read request headers instead.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Every page renders on each request: a `"use cache"` read below would otherwise hand the page its
// own `s-maxage`, and a shared-cache hit skips the locale redirect in `src/proxy.ts`. A child
// segment can override this, so `tests/e2e/cache-headers.test.ts` checks the public pages.
export const dynamic = "force-dynamic";

// Metadata coerces an unknown segment instead of calling `notFound()`: the layout below rejects it
// anyway, and the metadata built here is thrown away with the 404 page. Coercing keeps the tag
// builders off an invalid locale, which would otherwise throw before the layout can answer.
function resolveLocale(locale: string): Locale {
  return hasLocale(routing.locales, locale) ? locale : DEFAULT_LOCALE;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const resolved = resolveLocale(locale);
  // Seeds next-intl's cache slot so its own implicit-locale APIs (a server-rendered `<Link>`) skip
  // a `headers()` read. Best effort only: the slot misses at random, so nothing may rely on it for
  // locale resolution — our calls pass an explicit locale.
  setRequestLocale(resolved);

  return {
    ...(await buildRootMetadata(resolved)),
    openGraph: await buildSiteOpenGraph(resolved),
  };
}

export default async function LocaleRootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Same cache hint as in `generateMetadata` above, never a source of truth for the locale.
  setRequestLocale(locale);

  return <RootShell locale={locale}>{children}</RootShell>;
}
