import { ClientMessagesProvider } from "@/components/client-messages-provider";
import NavFooterLayout from "@/layouts/NavFooterLayout";
import { CLIENT_MESSAGE_SCOPES } from "@/i18n/client-namespaces";
import type { Locale } from "@/i18n/config";

export default function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}) {
  return (
    <ClientMessagesProvider params={params} namespaces={CLIENT_MESSAGE_SCOPES.auth.namespaces}>
      <NavFooterLayout params={params} renderFooter={false}>
        {children}
      </NavFooterLayout>
    </ClientMessagesProvider>
  );
}
