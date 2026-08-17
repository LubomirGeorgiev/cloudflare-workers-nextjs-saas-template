import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Logo } from "@/components/logo";
import { SITE_NAME } from "@/constants";
import { cn } from "@/lib/utils";

// Shared by `Navigation` and its Suspense fallback so the two trees stay pixel-identical
// and the swap does not shift the header.
export function NavigationShell({ children }: { children: ReactNode }) {
  return (
    <nav
      className={cn(
        "relative z-10 dark:bg-muted/30 bg-muted/60",
        "shadow-lg shadow-edge/10 dark:shadow-xl dark:shadow-edge/15",
        // Gradient hairline on the bottom edge: the accent holds across the middle
        // and fades to nothing at both ends. The `after:shadow-*` pair is a tight
        // bloom under the line — without it a 1px rule reads as almost nothing.
        "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px",
        "after:bg-[linear-gradient(to_right,transparent,var(--edge)_22%,var(--edge)_78%,transparent)]",
        "after:opacity-70 after:shadow-[0_0_8px_0px] after:shadow-edge/25 dark:after:shadow-edge/40",
      )}
    >
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
