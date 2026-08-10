import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getUserCredentialsAction } from "../../_actions/user-credentials-actions";
import { UserApiKeys } from "./user-api-keys";
import { UserConnectedApps } from "./user-connected-apps";
import { UserTeams } from "./user-teams";

/** One card per section, so the fallback matches the shape that replaces it. */
export function UserCredentialsSkeleton() {
  return (
    <div className="grid gap-6">
      {[0, 1, 2].map((index) => (
        <Card key={index}>
          <CardContent className="space-y-3 py-6">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full max-w-xl" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// Everything revocable that hangs off this account. Split from the page because the OAuth half is
// a KV scan: the profile renders immediately and this streams in behind its own Suspense boundary.
export async function UserCredentialsSection({ userId }: { userId: string }) {
  const t = await getTranslations("Client.Admin.UserDetail");
  const { data, serverError } = await getUserCredentialsAction({ userId });

  if (serverError || !data) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">
          {serverError?.message || t("loadError")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6">
      <UserConnectedApps userId={userId} apps={data.connectedApps} />
      <UserApiKeys userId={userId} apiKeys={data.apiKeys} />
      <UserTeams userId={userId} teams={data.teams} />
    </div>
  );
}
