import "server-only";

import { ApiKeysManager } from "@/components/api-keys/api-keys-manager";
import { listTeamApiKeys } from "@/lib/api-keys/api-keys";

// Rendered only for members holding MANAGE_API_KEYS; `listTeamApiKeys` re-checks the permission
// so the section can never leak keys through a stale render decision.
export async function TeamApiKeys({ teamId }: { teamId: string }) {
  const apiKeys = await listTeamApiKeys({ teamId });

  // No heading here: ApiKeysManager renders its own, and two titles for one section read as two.
  return (
    <div className="col-span-3 border rounded-lg p-6 bg-card">
      <ApiKeysManager apiKeys={apiKeys} teamId={teamId} />
    </div>
  );
}
