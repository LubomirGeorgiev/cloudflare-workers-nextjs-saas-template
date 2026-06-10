"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import { Suspense, useEffect } from "react"
import { EmailVerificationDialog } from "./email-verification-dialog"
import { useTopLoader } from 'nextjs-toploader'
import { usePathname, useRouter, useSearchParams, useParams } from "next/navigation"
import { SessionClientSync } from "./session-client-sync"
import { patchRouterRefreshForLoader } from "@/utils/router-refresh-loader"

function RouterChecker() {
  const { start, done } = useTopLoader()
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const params = useParams();

  useEffect(() => {
    const originalPush = router.push;
    const restoreRefresh = patchRouterRefreshForLoader({ router, start });

    // Monkey patch: https://github.com/vercel/next.js/discussions/42016#discussioncomment-9027313
    router.push = (href, options) => {
      start();
      originalPush.call(router, href, options);
    };

    return () => {
      router.push = originalPush;
      restoreRefresh();
    };
  }, [router, start])

  useEffect(() => {
    done();
  }, [pathname, searchParams, params]);

  return null;
}

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <>
      <Suspense>
        <RouterChecker />
      </Suspense>
      <NextThemesProvider {...props} attribute="class">
        <SessionClientSync />
        {children}
        <EmailVerificationDialog />
      </NextThemesProvider>
    </>
  )
}
