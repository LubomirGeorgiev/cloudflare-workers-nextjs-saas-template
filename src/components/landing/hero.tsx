import { buttonVariants } from "@/components/ui/button";
import { GITHUB_REPO_URL } from "@/constants";
import { Link } from "@/i18n/navigation";
import { Suspense } from "react";
import { ArrowRight, Star } from "lucide-react";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/translator";
import { DeployTerminal } from "@/components/landing/deploy-terminal";
import {
  GithubStarsBadge,
  GithubStarsBadgeFallback,
} from "@/components/github-stars-badge";
import { cn } from "@/lib/utils";

export async function Hero({ locale }: { locale: Locale }) {
  const t = await getTranslator({ locale, namespace: "Landing.Hero" });
  return (
    <section className="relative isolate overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-grid opacity-50 mask-[radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent_75%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 size-168 -translate-x-1/2 rounded-full bg-edge/15 blur-[120px]"
      />

      <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 pb-24 pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:px-8 lg:pb-32 lg:pt-28">
        <div>
          <Suspense fallback={<GithubStarsBadgeFallback />}>
            <GithubStarsBadge locale={locale} />
          </Suspense>

          <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
            {t("titleLine1")}
            <br />
            {t("titleLine2")}{" "}
            <span className="relative whitespace-nowrap text-edge">
              {t("titleEdge")}
              <svg
                aria-hidden
                viewBox="0 0 200 14"
                className="absolute -bottom-2 left-0 w-full text-edge/50"
                preserveAspectRatio="none"
              >
                <path
                  d="M2 10 C 50 4, 150 4, 198 9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            .
          </h1>

          <p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground">
            {t("description")}
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(
                buttonVariants({ size: "lg" }),
                "group gap-2 bg-edge text-edge-foreground shadow-lg shadow-edge/20 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-edge/90 hover:shadow-xl hover:shadow-edge/30 active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
              )}
            >
              <Star className="size-5 fill-current transition-transform duration-300 ease-out group-hover:scale-125 group-hover:-rotate-12 motion-reduce:transform-none" />
              {t("starOnGithub")}
            </a>
            <Link
              href="/sign-in"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "group gap-2",
              )}
            >
              {t("tryLiveDemo")}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>

        <div className="lg:pl-4">
          <DeployTerminal />
        </div>
      </div>
    </section>
  );
}
