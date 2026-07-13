import type { Metadata } from "next";
import "./globals.css";
import "server-only";

import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";

import { getClientMessages } from "@/i18n/client-messages";

import { ThemeProvider } from "@/components/providers";
import { NavigationTopLoader } from "@/components/navigation-top-loader";
import { StreamedMetadataHoister } from "@/components/streamed-metadata-hoister";
import { AskiChatStickyBanner } from "@/components/aski-chat-sticky-banner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SITE_NAME, SITE_DESCRIPTION, SITE_URL } from "@/constants";
import { getPublicConfig } from "@/flags";
import { PublicConfigHydrator } from "@/components/public-config-hydrator";

export const metadata: Metadata = {
  title: {
    default: SITE_NAME,
    template: `%s - ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  authors: [{ name: "Lubomir Georgiev" }],
  creator: "Lubomir Georgiev",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    creator: "@LubomirGeorg",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

async function PublicConfigRootHydrator() {
  const publicConfig = await getPublicConfig();

  return <PublicConfigHydrator publicConfig={publicConfig} />;
}

export default async function BaseLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  // Forward only the namespaces client components use, instead of the whole
  // catalog, so server-only messages are not serialized into every page payload.
  const messages = await getClientMessages();

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
