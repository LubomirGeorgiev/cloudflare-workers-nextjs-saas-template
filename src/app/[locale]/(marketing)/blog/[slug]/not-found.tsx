import { Link } from "@/i18n/navigation"
import { getTranslations } from "next-intl/server"
import { buttonVariants } from "@/components/ui/button"

export default async function BlogPostNotFound() {
  const t = await getTranslations("Blog.PostNotFound")

  return (
    <div className="container mx-auto py-12">
      <div className="max-w-3xl mx-auto text-center">
        <h1 className="text-4xl font-bold mb-4">{t("title")}</h1>
        <p className="text-xl text-muted-foreground mb-8">
          {t("description")}
        </p>
        <Link href="/blog" className={buttonVariants()}>
          {t("backToBlog")}
        </Link>
      </div>
    </div>
  )
}
