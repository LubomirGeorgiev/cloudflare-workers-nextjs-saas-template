import { ClientMessagesProvider } from "@/components/client-messages-provider";
import { CLIENT_MESSAGE_SCOPES } from "@/i18n/client-namespaces";
import type { Locale } from "@/i18n/config";

// Exists only to scope the signed-in app's client messages; the admin, dashboard, settings, and
// OAuth consent routes below keep their own chrome.
export default function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}) {
  return (
    <ClientMessagesProvider params={params} namespaces={CLIENT_MESSAGE_SCOPES.app.namespaces}>
      {children}
    </ClientMessagesProvider>
  );
}
