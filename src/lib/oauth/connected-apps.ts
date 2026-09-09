import "server-only";

import { MAX_OAUTH_GRANTS_PER_USER } from "@/constants";

import { getOAuthAppsByClientIds } from "@/lib/oauth/oauth-apps";
import { getOAuthHelpers } from "@/lib/oauth/provider-api";
import { requireVerifiedEmail } from "@/utils/auth";
import { deleteOAuthGrantCache } from "@/utils/kv-oauth-grant";

export interface ConnectedApp {
  grantId: string;
  clientId: string;
  name: string | null;
  logoUri: string | null;
  isVerified: boolean;
  scopes: string[];
  grantedAt: number | null;
}

// A user with more grants than this has something pathological going on; the cap keeps one page
// render from turning into an unbounded KV scan.
const MAX_GRANT_PAGES = 5;
const GRANT_PAGE_SIZE = 100;

// One revocation is a provider write plus a KV cache delete, so every revoke path shares this width
// to stay inside the Worker subrequest budget.
export const GRANT_REVOKE_BATCH_SIZE = 5;

interface GrantConsentMetadata {
  createdAt?: unknown;
  clientNameAtConsent?: unknown;
}

export async function listConnectedApps(): Promise<ConnectedApp[]> {
  const session = await requireVerifiedEmail();

  return listConnectedAppsForUser({ userId: session.userId });
}

// Identity comes from D1, not `lookupClient()`: a DCR client's KV record expires after 90 days
// while its grants live on, and "Unknown app" is the one thing this page must never show. The
// consent-time name is the last fallback — it is what the user actually approved.
//
// Carries no authorization of its own: only call it behind one (the owner's session, or admin).
export async function listConnectedAppsForUser({ userId }: { userId: string }): Promise<ConnectedApp[]> {
  const helpers = getOAuthHelpers();

  const grants = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_GRANT_PAGES; page++) {
    const result = await helpers.listUserGrants(userId, {
      cursor,
      limit: GRANT_PAGE_SIZE,
    });
    grants.push(...result.items);
    cursor = result.cursor;
    if (!cursor) {
      break;
    }
  }

  const apps = await getOAuthAppsByClientIds([...new Set(grants.map((grant) => grant.clientId))]);

  return grants.map((grant) => {
    const app = apps.get(grant.clientId);
    const metadata = (grant.metadata ?? {}) as GrantConsentMetadata;
    const consentName = typeof metadata.clientNameAtConsent === "string"
      ? metadata.clientNameAtConsent
      : null;

    return {
      grantId: grant.id,
      clientId: grant.clientId,
      name: app?.name ?? consentName,
      logoUri: app?.logoUri ?? null,
      isVerified: Boolean(app?.verifiedAt),
      scopes: grant.scope,
      grantedAt: typeof metadata.createdAt === "number"
        ? metadata.createdAt
        : grant.createdAt * 1000,
    };
  }).sort((a, b) => (b.grantedAt ?? 0) - (a.grantedAt ?? 0));
}

export async function revokeConnectedApp({ grantId }: { grantId: string }): Promise<void> {
  const session = await requireVerifiedEmail();

  await revokeConnectedAppForUser({ grantId, userId: session.userId });
}

// The provider deletes the grant and every access token minted from it; the refresh token dies
// with the grant. Effective immediately at the writing PoP, within ~60s everywhere else.
//
// Carries no authorization of its own: only call it behind one (the owner's session, or admin).
// `revokeGrant` scopes the delete to `userId`, so a grant belonging to anyone else is a no-op.
export async function revokeConnectedAppForUser({
  grantId,
  userId,
}: {
  grantId: string;
  userId: string;
}): Promise<void> {
  await getOAuthHelpers().revokeGrant(grantId, userId);
  await deleteOAuthGrantCache({ grantId });
}

/** What one new consent costs the account: this client's own grants, and the overflow it evicts. */
interface GrantCapSelection {
  replaced: ConnectedApp[];
  evicted: ConnectedApp[];
}

/**
 * Splits the account's grants into the ones this consent replaces and the ones it disconnects.
 *
 * Pure and shared, so the warning the consent screen shows and the eviction the approval performs
 * are the same decision: an off-by-one here would name one app and disconnect another.
 *
 * The client's own grants are `replaced`, never overflow: a consent mints one grant and drops the
 * old one, so those slots free themselves and must never count against the cap.
 */
export function selectGrantCapEvictions({
  apps,
  clientId,
}: {
  apps: ConnectedApp[];
  clientId: string;
}): GrantCapSelection {
  const replaced = apps.filter((app) => app.clientId === clientId);
  const others = apps
    .filter((app) => app.clientId !== clientId)
    .sort((a, b) => (a.grantedAt ?? 0) - (b.grantedAt ?? 0));
  // One slot has to be free for the grant about to be created, hence the -1.
  const overflow = others.length - (MAX_OAUTH_GRANTS_PER_USER - 1);

  // Sorted here rather than trusted from the caller, so the oldest goes out whatever order it came
  // in. `evicted` stays oldest first: the warning lists them in the order they will go.
  return {
    replaced,
    evicted: overflow > 0 ? others.slice(0, overflow) : [],
  };
}
