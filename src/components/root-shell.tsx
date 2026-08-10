import "server-only";
import "@/app/globals.css";

import { NextIntlClientProvider } from "next-intl";

import { ThemeProvider } from "@/components/providers";
import { NavigationTopLoader } from "@/components/navigation-top-loader";
import { StreamedMetadataHoister } from "@/components/streamed-metadata-hoister";
import { AskiChatStickyBanner } from "@/components/aski-chat-sticky-banner";
import { PublicConfigHydrator } from "@/components/public-config-hydrator";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getPublicConfig } from "@/flags";
import { getClientMessages } from "@/i18n/client-messages";
import type { Locale } from "@/i18n/config";

async function PublicConfigRootHydrator() {
  const publicConfig = await getPublicConfig();

  return <PublicConfigHydrator publicConfig={publicConfig} />;
}

interface RootShellProps {
  locale: Locale;
  children: React.ReactNode;
}

// The one `<html>`/`<body>` shell, rendered by the single root layout `app/[locale]/layout.tsx`.
// Every route lives under that root so React can keep the DOM — and this `<Toaster>` — alive across
// navigations; a second root would tear the document down and destroy any toast raised before it.
export async function RootShell({ locale, children }: RootShellProps) {
  const messages = await getClientMessages(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <PublicConfigRootHydrator />
          <StreamedMetadataHoister />
          <NavigationTopLoader />
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
          >
            <TooltipProvider
              delayDuration={100}
              skipDelayDuration={50}
            >
              {children}
            </TooltipProvider>
          </ThemeProvider>
          <Toaster richColors closeButton position="top-right" expand duration={7000} />
          <AskiChatStickyBanner />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
