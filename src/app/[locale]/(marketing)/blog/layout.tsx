import type { ReactNode } from "react"

import { ClientMessagesProvider } from "@/components/client-messages-provider"
import { CLIENT_MESSAGE_SCOPES } from "@/i18n/client-namespaces"
import type { Locale } from "@/i18n/config"

interface BlogLayoutProps {
  children: ReactNode
  params: Promise<{ locale: Locale }>
}

export default function BlogLayout({ children, params }: BlogLayoutProps) {
  return (
    <ClientMessagesProvider params={params} namespaces={CLIENT_MESSAGE_SCOPES.blog.namespaces}>
      <div className="px-4 md:px-6 lg:px-8">{children}</div>
    </ClientMessagesProvider>
  )
}
