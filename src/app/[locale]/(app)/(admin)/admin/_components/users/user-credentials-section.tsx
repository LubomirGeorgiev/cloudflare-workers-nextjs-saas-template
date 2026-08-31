import { getUserCredentials } from "@/lib/admin/user-credentials";
import { UserApiKeys } from "./user-api-keys";
import { UserConnectedApps } from "./user-connected-apps";
import { UserTeams } from "./user-teams";

// Everything revocable that hangs off this account. Split from the page because the OAuth half is
// a KV scan: the profile renders immediately and this streams in behind its own Suspense boundary.
// `getUserCredentials` guards itself, so this is a safe entry point into the data layer.
export async function UserCredentialsSection({ userId }: { userId: string }) {
  const { connectedApps, apiKeys, teams } = await getUserCredentials({ userId });

  return (
    <div className="grid gap-6">
      <UserConnectedApps userId={userId} apps={connectedApps} />
      <UserApiKeys userId={userId} apiKeys={apiKeys} />
      <UserTeams userId={userId} teams={teams} />
    </div>
  );
}
