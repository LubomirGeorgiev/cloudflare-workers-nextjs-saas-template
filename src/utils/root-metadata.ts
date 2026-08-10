import "server-only";

import type { Metadata } from "next";

import { SITE_NAME, SITE_URL } from "@/constants";
import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/translator";

// Site-wide metadata defaults for the root layout `app/[locale]/layout.tsx`.
//
// Uses `getTranslator` rather than `next-intl/server`: the request-scoped API resolves the locale
// through `requestLocale`, which reads `headers()` and would mark the render dynamic — the exact
// thing taking the locale from the URL segment exists to avoid.
export async function buildRootMetadata(locale: Locale): Promise<Metadata> {
  const t = await getTranslator({ locale, namespace: "Landing.meta" });
  const description = t("description");

  return {
    title: {
      default: SITE_NAME,
      template: `%s - ${SITE_NAME}`,
    },
    description,
    metadataBase: new URL(SITE_URL),
    authors: [{ name: "Lubomir Georgiev" }],
    creator: "Lubomir Georgiev",
    twitter: {
      card: "summary_large_image",
      title: SITE_NAME,
      description,
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
}
