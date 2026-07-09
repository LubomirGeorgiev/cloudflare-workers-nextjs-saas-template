import { PageHeader } from "@/components/page-header"
import { COMPONENTS } from "./components-catalog"
import { MarketplaceCard } from "@/components/marketplace-card"
import { getSessionFromCookie } from "@/utils/auth"
import { getUserPurchasedItems } from "@/utils/credits"
import { DISABLE_CREDIT_BILLING_SYSTEM } from "@/constants"
import { CreditSystemDisabled } from "@/components/credit-system-disabled"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { getTranslations } from "next-intl/server"

export default async function MarketplacePage() {
  const session = await getSessionFromCookie();
  const purchasedItems = session ? await getUserPurchasedItems(session.userId) : new Set();
  const t = await getTranslations("Client.Dashboard.Marketplace");

  return (
    <>
      <PageHeader
        items={[
          {
            href: "/dashboard/marketplace",
            label: t("breadcrumbMarketplace")
          }
        ]}
      />
      <div className="container mx-auto px-5 pb-12">
        {DISABLE_CREDIT_BILLING_SYSTEM ? (
          <CreditSystemDisabled />
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-4xl font-bold mt-4">{t("title")}</h1>
              <p className="text-muted-foreground mt-2">
                {t("subtitle")}
              </p>
            </div>

            <Alert className="mb-6">
              <AlertTitle>{t("demoAlertTitle")}</AlertTitle>
              <AlertDescription>
                {t("demoAlertDescription")}
              </AlertDescription>
            </Alert>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {COMPONENTS.map((component) => (
                <MarketplaceCard
                  key={component.id}
                  id={component.id}
                  name={component.name}
                  description={component.description}
                  credits={component.credits}
                  containerClass={component.containerClass}
                  isPurchased={purchasedItems.has(`COMPONENT:${component.id}`)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
