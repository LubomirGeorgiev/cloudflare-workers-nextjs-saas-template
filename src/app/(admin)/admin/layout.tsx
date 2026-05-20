import { AdminSidebar } from "./_components/admin-sidebar"
import { requireAdmin } from "@/utils/auth"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { redirect } from "next/navigation"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin({ doNotThrowError: true })

  if (!session) {
    return redirect('/')
  }

  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset className="w-full flex flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 md:hidden">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">Admin</span>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
