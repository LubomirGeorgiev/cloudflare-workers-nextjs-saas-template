import { Button } from "@/components/ui/button";
import { GITHUB_REPO_URL } from "@/constants";
import Link from "next/link";
import { useRouter } from "next/router";
import ShinyButton from "@/components/ui/shiny-button";
import { getTotalUsers } from "@/utils/stats";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import enCommon from "../../../locales/en/common.json";
import jaCommon from "../../../locales/ja/common.json";

const translations: Record<string, Record<string, string>> = {
  en: enCommon,
  ja: jaCommon,
};

function translate(locale: string, key: string, fallback: string): string {
  return translations[locale]?.[key] || fallback;
}

export function Hero() {
  const router = useRouter();
  const locale = router.locale || router.defaultLocale || "en";
  const heroTitle = translate(locale, "heroTitle", "Production-Ready SaaS Template");

  return (
    <div className="relative isolate pt-14 dark:bg-gray-900">
      <div className="pt-20 pb-24 sm:pt-20 sm:pb-32 lg:pb-40">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mb-10 flex justify-center gap-4 flex-wrap">
              <ShinyButton className="rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-inset ring-indigo-500/20">
                100% Free & Open Source
              </ShinyButton>
              <Suspense fallback={<TotalUsersButtonSkeleton />}>
                <TotalUsersButton />
              </Suspense>
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent">
              {heroTitle}
            </h1>
            <p className="mt-6 text-lg leading-8 text-muted-foreground">
              A modern, open-source template for building SaaS applications with Next.js 15,
              Cloudflare Workers, and everything you need to launch quickly.
            </p>
            <div className="mt-10 flex items-center justify-center gap-x-4 md:gap-x-6">
              <a href={GITHUB_REPO_URL} target="_blank">
                <Button size="lg" className="rounded-full">
                  View on GitHub
                </Button>
              </a>
              <Link href="/sign-in">
                <Button variant="outline" size="lg" className="rounded-full">
                  Try Demo
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// This component will be wrapped in Suspense
async function TotalUsersButton() {
  const totalUsers = await getTotalUsers();

  if (!totalUsers) return null;

  return (
    <ShinyButton className="rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 ring-1 ring-inset ring-purple-500/20">
      {totalUsers} Users & Growing
    </ShinyButton>
  );
}

// Skeleton fallback for the TotalUsersButton
function TotalUsersButtonSkeleton() {
  return (
    <div className="rounded-full bg-purple-500/10 ring-1 ring-inset ring-purple-500/20 px-4 py-1.5 text-sm font-medium">
      <Skeleton className="w-32 h-5" />
    </div>
  );
}
