import { type ReactNode } from "react";

import { ClientMessagesProvider } from "@/components/client-messages-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import NavFooterLayout from "@/layouts/NavFooterLayout";
import { CLIENT_MESSAGE_SCOPES } from "@/i18n/client-namespaces";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/translator";

export default function LegalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: Locale }>;
}) {
  return (
    <ClientMessagesProvider params={params} namespaces={CLIENT_MESSAGE_SCOPES.legal.namespaces}>
      <NavFooterLayout params={params}>
        <div className="min-h-screen bg-background px-4 py-12">
          <div className="max-w-3xl mx-auto px-6 bg-muted/50 rounded-xl shadow-lg py-12">
            <div className="prose prose-gray dark:prose-invert max-w-none">
              <PlaceholderNotice params={params} />
              {children}
            </div>
          </div>
        </div>
      </NavFooterLayout>
    </ClientMessagesProvider>
  );
}

// The legal pages ship placeholder text. A fork writes its own text, then deletes this notice.
async function PlaceholderNotice({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const t = await getTranslator({ locale, namespace: "Legal" });

  return (
    <Alert variant="warning" className="not-prose mb-6">
      <AlertDescription>{t("placeholderNotice")}</AlertDescription>
    </Alert>
  );
}
