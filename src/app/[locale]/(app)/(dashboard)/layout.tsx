import { AppSidebar } from "@/components/app-sidebar"
import { SessionHydrator } from "@/components/session-hydrator"
import { getCurrentSession } from "@/utils/auth"
import { isBillingEnabled } from "@/flags"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { redirect } from "@/i18n/navigation"
import { type Locale } from "@/i18n/config"
import { getTranslator } from "@/i18n/translator"

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: Locale }>
}) {
  const session = await getCurrentSession()
  const { locale } = await params
  const t = await getTranslator({ locale, namespace: "Client.Dashboard.layout" })

  if (!session) {
    return redirect({ href: '/', locale })
  }

  return (
    <SessionHydrator session={session}>
      <SidebarProvider>
        <AppSidebar serverSession={session} billingEnabled={isBillingEnabled()} />
        <SidebarInset className="w-full flex flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 px-4 md:hidden">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm font-medium">{t("header")}</span>
          </header>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </SessionHydrator>
  )
}
