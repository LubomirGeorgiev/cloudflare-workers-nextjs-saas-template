import { ClientMessagesProvider } from "@/components/client-messages-provider";
import NavFooterLayout from "@/layouts/NavFooterLayout";
import { CLIENT_MESSAGE_SCOPES } from "@/i18n/client-namespaces";
import type { Locale } from "@/i18n/config";

export default function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}) {
  return (
    <ClientMessagesProvider params={params} namespaces={CLIENT_MESSAGE_SCOPES.marketing.namespaces}>
      <NavFooterLayout params={params}>{children}</NavFooterLayout>
    </ClientMessagesProvider>
  );
}
