import "server-only";

import { NextIntlClientProvider } from "next-intl";

import { getClientMessages } from "@/i18n/client-messages";
import type { ClientNamespace } from "@/i18n/client-namespaces";
import type { Locale } from "@/i18n/config";

interface ClientMessagesProviderProps {
  // Awaited here rather than in the caller so a route group's layout can stay synchronous.
  params: Promise<{ locale: Locale }>;
  namespaces: readonly ClientNamespace[];
  children: React.ReactNode;
}

// The nested provider a route group's layout renders below the root shell. It REPLACES the root
// messages for its subtree instead of merging with them, so `namespaces` must name every namespace
// that subtree reads; `CLIENT_MESSAGE_SCOPES` holds the list and the test that proves it complete.
export async function ClientMessagesProvider({
  params,
  namespaces,
  children,
}: ClientMessagesProviderProps) {
  const { locale } = await params;
  const messages = await getClientMessages({ locale, namespaces });

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
