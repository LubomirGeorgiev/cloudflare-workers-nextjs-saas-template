"use client";

import { KeyRound } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ADMIN_USERS_PATH, API_KEY_CACHE_TTL_SECONDS } from "@/constants";
import { Link } from "@/i18n/navigation";
import type { AdminTeamApiKey, AdminTeamSectionList } from "@/lib/admin/teams";
import { revokeUserApiKeyAction } from "../../_actions/user-credentials-actions";
import { AdminApiKeysTable } from "../admin-api-keys-table";
import { AdminDetailSection } from "../admin-detail-section";

// Team-scoped keys have an owner, and revocation is the owner's operation: the same action the
// user page revokes with, passed this key's owner, so one code path revokes from either page.
export function TeamApiKeys({
  apiKeys,
}: {
  apiKeys: AdminTeamSectionList<AdminTeamApiKey>;
}) {
  const router = useRouter();
  const { items, hasMore } = apiKeys;

  const { executeAsync: revokeKey } = useAction(revokeUserApiKeyAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to revoke the API key");
    },
    onSuccess: () => {
      toast.success("API key revoked");
      router.refresh();
    },
  });

  const revocationNotice = `A revoked key stops working everywhere within ${Math.ceil(API_KEY_CACHE_TTL_SECONDS / 60)} minutes.`;
  const description = hasMore
    ? `The first ${items.length} live keys scoped to this team. This team has more. ${revocationNotice}`
    : `Live keys scoped to this team. ${revocationNotice}`;

  return (
    <AdminDetailSection
      icon={KeyRound}
      title={`Team API keys (${items.length}${hasMore ? "+" : ""})`}
      description={description}
      emptyMessage="This team has no active API keys"
      isEmpty={items.length === 0}
    >
      <AdminApiKeysTable
        apiKeys={items}
        subjectHeader="Owner"
        renderSubject={(apiKey) => (
          <Link href={`${ADMIN_USERS_PATH}/${apiKey.ownerId}`} className="hover:underline">
            {apiKey.ownerEmail || apiKey.ownerId}
          </Link>
        )}
        onRevoke={(apiKey) => revokeKey({ userId: apiKey.ownerId, keyId: apiKey.id })}
      />
    </AdminDetailSection>
  );
}
