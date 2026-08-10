import { getTranslations } from "next-intl/server";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { PageHeader } from "@/components/page-header";
import { ADMIN_OAUTH_APPS_PATH } from "@/constants";
import { OAuthAppsTable } from "../_components/oauth-apps/oauth-apps-table";

export async function generateMetadata() {
  const t = await getTranslations("Client.Admin.OAuthApps");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function AdminOAuthAppsPage() {
  const t = await getTranslations("Client.Admin.OAuthApps");

  return (
    <NuqsAdapter>
      <PageHeader
        items={[
          { href: "/admin", label: t("breadcrumbAdmin") },
          { href: ADMIN_OAUTH_APPS_PATH, label: t("breadcrumbOAuthApps") },
        ]}
      />
      <OAuthAppsTable />
    </NuqsAdapter>
  );
}
