import { PageHeader } from "@/components/page-header"
import { getTranslations } from "next-intl/server"

export default async function Page() {
  const t = await getTranslations("Client.Dashboard.Home")

  return (
    <>
      <PageHeader
        items={[
          {
            href: "/dashboard",
            label: t("breadcrumb")
          }
        ]}
      />
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div className="grid auto-rows-min gap-4 md:grid-cols-3">
          <div className="aspect-video rounded-xl bg-muted/50 flex items-center justify-center">
            {t("example")}
          </div>
          <div className="aspect-video rounded-xl bg-muted/50 flex items-center justify-center">
            {t("example")}
          </div>
          <div className="aspect-video rounded-xl bg-muted/50 flex items-center justify-center">
            {t("example")}
          </div>
        </div>
        <div className="min-h-[100vh] flex-1 rounded-xl bg-muted/50 md:min-h-min flex items-center justify-center">
          {t("example")}
        </div>
      </div>
    </>
  )
}
