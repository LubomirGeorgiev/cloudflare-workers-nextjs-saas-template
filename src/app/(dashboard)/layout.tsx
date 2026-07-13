import { AppSidebar } from "@/components/app-sidebar"
import { SessionHydrator } from "@/components/session-hydrator"
import { getSessionFromCookie } from "@/utils/auth"
import { isBillingEnabled } from "@/flags"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionFromCookie()
  const t = await getTranslations("Client.Dashboard.layout")

  if (!session) {
    return redirect('/')
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
