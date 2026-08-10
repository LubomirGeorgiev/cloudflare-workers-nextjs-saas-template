import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/logo";
import { SITE_NAME } from "@/constants";

// Shared by `Navigation` and its Suspense fallback so the two trees stay pixel-identical
// and the swap does not shift the header.
export function NavigationShell({ children }: { children: ReactNode }) {
  return (
    <nav className="dark:bg-muted/30 bg-muted/60 shadow dark:shadow-xl z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link href="/" prefetch={false} className="text-xl md:text-2xl font-bold text-primary flex items-center gap-2 md:gap-3">
              <Logo className="w-6 h-6 md:w-7 md:h-7" />
              {SITE_NAME}
            </Link>
          </div>
          {children}
        </div>
      </div>
    </nav>
  );
}

export function NavigationLinksSkeleton() {
  return (
    <>
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-8 w-16" />
    </>
  );
}

export function NavigationActionSkeleton() {
  return <Skeleton className="h-10 w-[80px] bg-primary" />;
}
