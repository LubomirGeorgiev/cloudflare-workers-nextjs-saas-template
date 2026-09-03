"use client";

// "use client" on purpose: not-found gets no `params`, so the locale comes from `NextIntlClientProvider`.
import { Link } from "@/i18n/navigation"
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export default function BlogPostNotFound() {
  const t = useTranslations("Client.Blog.PostNotFound")

  return (
    <div className="relative isolate mx-auto max-w-3xl overflow-hidden py-24 sm:py-32">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-grid opacity-50 mask-[radial-gradient(ellipse_70%_80%_at_50%_0%,black,transparent_80%)]"
      />
      <div className="text-center">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg leading-8 text-muted-foreground">
          {t("description")}
        </p>
        <Link href="/blog" className={cn(buttonVariants(), "mt-8")}>
          {t("backToBlog")}
        </Link>
      </div>
    </div>
  )
}
