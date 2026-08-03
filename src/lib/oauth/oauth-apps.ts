import "server-only";

import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import { getDB } from "@/db";
import { oauthAppTable, type OAuthAppRegistrationSource } from "@/db/schema";
import { isCimdClientId } from "@/lib/oauth/client-identity";

interface OAuthAppSummary {
  id: string;
  clientId: string;
  name: string | null;
  logoUri: string | null;
  redirectUris: string[];
  registrationSource: OAuthAppRegistrationSource | null;
  verifiedAt: Date | null;
  lastRenewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface UpsertOAuthAppParams {
  clientId: string;
  name?: string | null;
  logoUri?: string | null;
  redirectUris?: string[] | null;
  tokenEndpointAuthMethod?: string | null;
  registrationSource: OAuthAppRegistrationSource;
}

const SUMMARY_COLUMNS = {
  id: true,
  clientId: true,
  name: true,
  logoUri: true,
  redirectUris: true,
  registrationSource: true,
  verifiedAt: true,
  lastRenewedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type OAuthAppQuery = Parameters<ReturnType<typeof getDB>["query"]["oauthAppTable"]["findMany"]>[0];

// The summary-shaped listing every paged read shares; only `where`/`orderBy`/`limit` ever differ.
async function listApps(
  query: Pick<NonNullable<OAuthAppQuery>, "where" | "orderBy" | "limit">,
): Promise<OAuthAppSummary[]> {
  const rows = await getDB().query.oauthAppTable.findMany({ columns: SUMMARY_COLUMNS, ...query });

  return rows.map(toSummary);
}

function toSummary(row: {
  id: string;
  clientId: string;
  name: string | null;
  logoUri: string | null;
  redirectUris: string[] | null;
  registrationSource: OAuthAppRegistrationSource | null;
  verifiedAt: Date | null;
  lastRenewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): OAuthAppSummary {
  return { ...row, redirectUris: row.redirectUris ?? [] };
}

// Early CIMD mirrors were labelled DCR by the consent backstop. URL-shaped DCR IDs are never
// issued, so this correction is deterministic and leaves the row's verification decision intact.
export async function correctLegacyCimdOAuthAppSources(clientIds: string[]): Promise<void> {
  const cimdClientIds = clientIds.filter(isCimdClientId);
  if (cimdClientIds.length === 0) {
    return;
  }

  const db = getDB();
  await db
    .update(oauthAppTable)
    .set({ registrationSource: "cimd" })
    .where(and(
      inArray(oauthAppTable.clientId, cimdClientIds),
      eq(oauthAppTable.registrationSource, "dcr"),
    ));
}

// Idempotent mirror of a client registration. Called from the DCR response interceptor and again
// as a backstop at first consent, so a row exists even if the interception was missed.
// `verifiedAt` is never written here — verification is an explicit admin decision.
export async function upsertOAuthApp(params: UpsertOAuthAppParams): Promise<void> {
  const db = getDB();
  const values = {
    clientId: params.clientId,
    name: params.name ?? null,
    logoUri: params.logoUri ?? null,
    redirectUris: params.redirectUris ?? null,
    tokenEndpointAuthMethod: params.tokenEndpointAuthMethod ?? null,
    registrationSource: params.registrationSource,
  };

  await db
    .insert(oauthAppTable)
    .values(values)
    .onConflictDoUpdate({
      // Client ID is the only identity key. Similar names, logos, or redirects must never merge
      // registrations or inherit the existing row's source or verification decision.
      target: oauthAppTable.clientId,
      set: {
        name: values.name,
        logoUri: values.logoUri,
        redirectUris: values.redirectUris,
        tokenEndpointAuthMethod: values.tokenEndpointAuthMethod,
        updatedAt: new Date(),
      },
    });
}

export async function getOAuthAppByClientId(clientId: string): Promise<OAuthAppSummary | null> {
  const db = getDB();
  const row = await db.query.oauthAppTable.findFirst({
    columns: SUMMARY_COLUMNS,
    where: { clientId },
  });

  return row ? toSummary(row) : null;
}

// Grants outlive the provider's KV client record (DCR entries expire after 90 days), so the
// connected-apps list joins identity from D1 rather than lookupClient().
export async function getOAuthAppsByClientIds(
  clientIds: string[],
): Promise<Map<string, OAuthAppSummary>> {
  if (clientIds.length === 0) {
    return new Map();
  }

  const db = getDB();
  const rows = await db.query.oauthAppTable.findMany({
    columns: SUMMARY_COLUMNS,
    where: { clientId: { in: clientIds } },
  });

  return new Map(rows.map((row) => [row.clientId, toSummary(row)]));
}

export async function listOAuthApps({
  page,
  pageSize,
}: {
  page: number;
  pageSize: number;
}): Promise<{ apps: OAuthAppSummary[]; totalCount: number }> {
  const db = getDB();

  const [[{ count }], rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(oauthAppTable),
    db.query.oauthAppTable.findMany({
      columns: SUMMARY_COLUMNS,
      orderBy: { createdAt: "desc" },
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  ]);

  return { apps: rows.map(toSummary), totalCount: count };
}

// Verification switches the app's consent scope tier. Only DCR rows also need cron renewal;
// stable CIMD and operator-created identities have no expiring DCR lease to renew.
export async function setOAuthAppVerified({
  clientId,
  isVerified,
}: {
  clientId: string;
  isVerified: boolean;
}): Promise<void> {
  const db = getDB();

  await db
    .update(oauthAppTable)
    .set({ verifiedAt: isVerified ? new Date() : null })
    .where(eq(oauthAppTable.clientId, clientId));
}

export async function deleteOAuthApp(clientId: string): Promise<void> {
  const db = getDB();
  await db.delete(oauthAppTable).where(eq(oauthAppTable.clientId, clientId));
}

// Renewal candidates for the scheduler: verified rows the sweep has not attempted since
// `dueBefore` (null = never attempted), oldest attempt first, capped so one cron tick stays well
// inside the subrequest budget. The cutoff lives in SQL so a page is never spent on rows that are
// not due yet.
export async function listOAuthAppsDueForRenewal({
  limit,
  dueBefore,
}: {
  limit: number;
  dueBefore: Date;
}): Promise<OAuthAppSummary[]> {
  return listApps({
    where: {
      registrationSource: "dcr",
      verifiedAt: { isNotNull: true },
      lastRenewedAt: { OR: [{ isNull: true }, { lt: dueBefore }] },
    },
    orderBy: { lastRenewedAt: "asc" },
    limit,
  });
}

// Candidates are deliberately narrower than "missing from provider KV": CIMD has no client KV
// record, operator-created clients do not use the DCR lease, and verified rows are never pruned.
export async function listExpiredUnverifiedDcrOAuthApps({
  limit,
  expiredBefore,
}: {
  limit: number;
  expiredBefore: Date;
}): Promise<OAuthAppSummary[]> {
  return listApps({
    where: {
      registrationSource: "dcr",
      verifiedAt: { isNull: true },
      createdAt: { lt: expiredBefore },
    },
    orderBy: { createdAt: "asc" },
    limit,
  });
}

async function deleteUnverifiedOAuthApps({
  clientIds,
  registrationSource,
  inactiveBefore,
}: {
  clientIds: string[];
  registrationSource: Extract<OAuthAppRegistrationSource, "cimd" | "dcr">;
  inactiveBefore?: Date;
}): Promise<number> {
  if (clientIds.length === 0) {
    return 0;
  }

  const db = getDB();
  const deleted = await db
    .delete(oauthAppTable)
    .where(and(
      inArray(oauthAppTable.clientId, clientIds),
      eq(oauthAppTable.registrationSource, registrationSource),
      isNull(oauthAppTable.verifiedAt),
      ...(inactiveBefore ? [lt(oauthAppTable.updatedAt, inactiveBefore)] : []),
    ))
    .returning({ clientId: oauthAppTable.clientId });

  return deleted.length;
}

// Re-checks the safety predicates in the DELETE so a concurrent admin verification wins over
// cleanup. The caller has already established that provider GC completed before selecting rows.
export function deleteUnverifiedDcrOAuthApps(clientIds: string[]): Promise<number> {
  return deleteUnverifiedOAuthApps({ clientIds, registrationSource: "dcr" });
}

// updatedAt advances on every approval. Once it is older than the maximum grant lifetime, no
// grant for this client can still exist; this avoids an unsafe, bounded scan of global grants.
export async function listExpiredUnverifiedCimdOAuthApps({
  limit,
  inactiveBefore,
}: {
  limit: number;
  inactiveBefore: Date;
}): Promise<OAuthAppSummary[]> {
  return listApps({
    where: {
      registrationSource: "cimd",
      verifiedAt: { isNull: true },
      updatedAt: { lt: inactiveBefore },
    },
    orderBy: { updatedAt: "asc" },
    limit,
  });
}

// Re-checks every safety predicate so a concurrent approval or admin verification wins over
// cleanup. The cutoff includes the provider's authorization-code window plus a safety margin.
export async function deleteExpiredUnverifiedCimdOAuthApps({
  clientIds,
  inactiveBefore,
}: {
  clientIds: string[];
  inactiveBefore: Date;
}): Promise<number> {
  return deleteUnverifiedOAuthApps({
    clientIds,
    registrationSource: "cimd",
    inactiveBefore,
  });
}

// Stamps the last renewal ATTEMPT, not the last success: `lastRenewedAt` is the sweep's scan
// order, so a client whose provider record is permanently gone must advance too or it pins the
// head of every future page and starves the healthy clients behind it.
export async function markOAuthAppsRenewalAttempted(clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) {
    return;
  }

  const db = getDB();
  await db
    .update(oauthAppTable)
    .set({ lastRenewedAt: new Date() })
    .where(inArray(oauthAppTable.clientId, clientIds));
}
