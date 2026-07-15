import { SiGithub as GithubIcon } from "@icons-pack/react-simple-icons";
import { ArrowRight, Star } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { GITHUB_REPO_URL } from "@/constants";
import { getGithubStars } from "@/utils/stats";
import { cn } from "@/lib/utils";

type BadgeSize = "sm" | "lg";

interface GithubStarsBadgeProps {
  size?: BadgeSize;
  className?: string;
}

const SIZES = {
  lg: {
    pill: "gap-3 py-1.5 pl-1.5 pr-5",
    chip: "gap-2 px-3 py-1.5",
    chipIcon: "size-4",
    chipText: "text-[11px]",
    chipSkeleton: "h-3 w-20",
    star: "size-5",
    count: "text-2xl",
    label: "text-[11px]",
    arrow: "size-4",
    skeleton: "h-6 w-12",
  },
  sm: {
    pill: "gap-2 py-1 pl-1 pr-4",
    chip: "gap-1.5 px-2.5 py-1",
    chipIcon: "size-3.5",
    chipText: "text-[10px]",
    chipSkeleton: "h-2.5 w-16",
    star: "size-4",
    count: "text-lg",
    label: "text-[10px]",
    arrow: "size-3.5",
    skeleton: "h-5 w-10",
  },
} as const;

const PILL_BASE =
  "group inline-flex items-center rounded-full border border-edge/40 bg-edge/10 shadow-lg shadow-edge/10 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-edge/70 hover:bg-edge/20 hover:shadow-xl hover:shadow-edge/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0";

export async function GithubStarsBadge({ size = "lg", className }: GithubStarsBadgeProps) {
  const [stars, t, locale] = await Promise.all([
    getGithubStars(),
    getTranslations("Client.GithubStars"),
    getLocale(),
  ]);
  const s = SIZES[size];

  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={stars ? t("starAriaWithCount", { count: stars }) : t("starAria")}
      className={cn(PILL_BASE, s.pill, className)}
    >
      <span className={cn("inline-flex items-center rounded-full bg-background/70", s.chip)}>
        <GithubIcon className={cn("text-foreground", s.chipIcon)} />
        <span
          className={cn(
            "font-mono font-medium uppercase tracking-wide text-muted-foreground",
            s.chipText,
          )}
        >
          {t("starTheRepo")}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <Star
          className={cn(
            "fill-edge text-edge transition-transform duration-300 ease-out group-hover:scale-125 group-hover:-rotate-12 motion-reduce:transform-none",
            s.star,
          )}
        />
        <span
          className={cn(
            "font-display font-bold leading-none tabular-nums text-foreground",
            s.count,
          )}
        >
          {stars ? stars.toLocaleString(locale) : t("github")}
        </span>
        {stars ? (
          <span
            className={cn(
              "font-mono uppercase tracking-wide text-muted-foreground",
              s.label,
            )}
          >
            {t("stars")}
          </span>
        ) : null}
      </span>
      <ArrowRight
        className={cn(
          "text-muted-foreground transition-all duration-300 ease-out group-hover:translate-x-1 group-hover:text-edge motion-reduce:transition-none",
          s.arrow,
        )}
      />
    </a>
  );
}

// Skeletons only — no copy — so the Suspense fallback never flashes English
// text on non-default locales (same rationale as DocsNavigationChromeFallback).
export function GithubStarsBadgeFallback({ size = "lg", className }: GithubStarsBadgeProps) {
  const s = SIZES[size];

  return (
    <div className={cn(PILL_BASE, s.pill, "pointer-events-none", className)}>
      <span className={cn("inline-flex items-center rounded-full bg-background/70", s.chip)}>
        <GithubIcon className={cn("text-foreground", s.chipIcon)} />
        <span className={cn("animate-pulse rounded bg-foreground/10", s.chipSkeleton)} />
      </span>
      <span className="flex items-center gap-2">
        <Star className={cn("fill-edge text-edge", s.star)} />
        <span className={cn("animate-pulse rounded bg-foreground/10", s.skeleton)} />
      </span>
    </div>
  );
}
