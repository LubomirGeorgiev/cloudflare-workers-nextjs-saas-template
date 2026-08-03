import { getTranslations } from "next-intl/server";

import { ApiKeysManager } from "@/components/api-keys/api-keys-manager";
import { McpConnectSection } from "@/components/mcp/mcp-connect-section";
import { PageErrorState } from "@/components/page-error-state";
import { resolvePageAction } from "@/utils/page-action-result";
import { getApiKeysAction, getConnectedAppsAction } from "./api-mcp.actions";
import { ConnectedAppsList } from "./connected-apps-list";

export async function generateMetadata() {
  const t = await getTranslations("Client.Settings.ApiMcp");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

// One surface for programmatic access: the credentials, the grants they produced, and the
// connection guide. Both reads are awaited above, so there is nothing left for a Suspense
// boundary to wait on — each child is a client island only because it handles its own input.
export default async function ApiMcpPage() {
  const [apiKeysResult, connectedAppsResult] = await Promise.all([
    getApiKeysAction(),
    getConnectedAppsAction(),
  ]);

  const [apiKeys, connectedApps] = await Promise.all([
    resolvePageAction(apiKeysResult),
    resolvePageAction(connectedAppsResult),
  ]);

  // Both reads share one credential and one rate-limit bucket, so when one fails the other almost
  // always failed the same way; showing the first reason beats stacking two identical cards.
  if (!apiKeys.ok) {
    return <PageErrorState message={apiKeys.message} />;
  }

  if (!connectedApps.ok) {
    return <PageErrorState message={connectedApps.message} />;
  }

  return (
    <div className="space-y-10">
      <ApiKeysManager apiKeys={apiKeys.data} />
      <ConnectedAppsList apps={connectedApps.data} />
      <McpConnectSection />
    </div>
  );
}
