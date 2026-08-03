import "server-only";

import {
  OAUTH_APP_PRUNE_PAGE_SIZE,
  OAUTH_CLIENT_REGISTRATION_TTL_SECONDS,
  OAUTH_CLIENT_RENEWAL_BATCH_SIZE,
  OAUTH_CLIENT_RENEWAL_INTERVAL_SECONDS,
  OAUTH_CLIENT_RENEWAL_PAGE_SIZE,
  OAUTH_UNVERIFIED_CIMD_RETENTION_SECONDS,
} from "@/constants";
import { isCimdClientId } from "@/lib/oauth/client-identity";
import {
  correctLegacyCimdOAuthAppSources,
  deleteExpiredUnverifiedCimdOAuthApps,
  deleteUnverifiedDcrOAuthApps,
  listExpiredUnverifiedDcrOAuthApps,
  listExpiredUnverifiedCimdOAuthApps,
  listOAuthAppsDueForRenewal,
  markOAuthAppsRenewalAttempted,
} from "@/lib/oauth/oauth-apps";
import { getOAuthHelpers } from "@/lib/oauth/provider-api";
import { mapInBatches } from "@/utils/map-in-batches";

// Early consent backstops labelled some CIMD clients as DCR. A URL-shaped client id is
// unambiguously CIMD, so both DCR-only sweeps correct those rows before acting on them — otherwise
// a CIMD identity could be handed a DCR lease it never had, or pruned as an expired one.
async function correctLegacyCimdAndKeepDcr<T extends { clientId: string }>(
  apps: T[],
): Promise<T[]> {
  await correctLegacyCimdOAuthAppSources(
    apps.filter((app) => isCimdClientId(app.clientId)).map((app) => app.clientId),
  );

  return apps.filter((app) => !isCimdClientId(app.clientId));
}

interface OAuthClientRenewalResult {
  /** Records re-put, and so alive for another full registration TTL. */
  renewed: number;
  /** Attempted, but the provider had no record to renew — the app has to register again. */
  missing: number;
  /** Attempted, but the re-put threw; retried on the next interval. */
  failed: number;
}

type RenewalOutcome = keyof OAuthClientRenewalResult;

// `updateClient(clientId, {})` re-puts the KV client record and re-applies its registration TTL —
// the official API doubling as our renewal mechanism, so verified apps never rot and no client
// record is immortal. Unverified apps are deliberately skipped: they expire on normal DCR garbage
// collection. Returns how each attempted client came out.
export async function renewVerifiedOAuthClients(
  now = new Date(),
): Promise<OAuthClientRenewalResult> {
  const dueBefore = new Date(now.getTime() - OAUTH_CLIENT_RENEWAL_INTERVAL_SECONDS * 1000);
  const due = await listOAuthAppsDueForRenewal({
    limit: OAUTH_CLIENT_RENEWAL_PAGE_SIZE,
    dueBefore,
  });

  const result: OAuthClientRenewalResult = { renewed: 0, missing: 0, failed: 0 };
  if (due.length === 0) {
    return result;
  }

  // Correct rows written by the old consent backstop before touching provider KV: persisting a
  // CIMD id through updateClient() would manufacture a DCR lease for an identity that has none.
  const renewable = await correctLegacyCimdAndKeepDcr(due);
  if (renewable.length === 0) {
    return result;
  }

  const helpers = getOAuthHelpers();

  const outcomes = await mapInBatches({
    items: renewable,
    batchSize: OAUTH_CLIENT_RENEWAL_BATCH_SIZE,
    fn: async (app): Promise<RenewalOutcome> => {
      try {
        // Null means the provider record is already gone, and nothing can bring it back: the
        // D1 row has no client secret, so the app must re-register.
        return (await helpers.updateClient(app.clientId, {})) ? "renewed" : "missing";
      } catch (error) {
        console.error("OAuth client renewal failed", { clientId: app.clientId, error });
        return "failed";
      }
    },
  });

  for (const outcome of outcomes) {
    result[outcome] += 1;
  }

  // Every ATTEMPTED row is stamped, not just the renewed ones: this column is the scan order, so
  // leaving dead clients unstamped would let a page of them occupy every future tick. A transient
  // failure costs one renewal interval, which is many times shorter than the registration TTL.
  await markOAuthAppsRenewalAttempted(renewable.map((app) => app.clientId));

  if (result.missing > 0 || result.failed > 0) {
    console.warn("OAuth clients could not be renewed", {
      missing: result.missing,
      failed: result.failed,
    });
  }

  return result;
}

// Provider-side garbage collection runs first. A complete sweep proves every grant for a missing
// DCR client was removed, which is the only safe point to prune its D1 identity mirror without a
// provider API for listing grants by client. Incomplete bounded sweeps deliberately prune nothing.
export async function purgeExpiredOAuthData(
  now = new Date(),
): Promise<{ mirrorsPruned: number; providerSweepComplete: boolean }> {
  const helpers = getOAuthHelpers();
  const providerResult = await helpers.purgeExpiredData();

  if (!providerResult.done) {
    return { mirrorsPruned: 0, providerSweepComplete: false };
  }

  const expiredBefore = new Date(
    now.getTime() - OAUTH_CLIENT_REGISTRATION_TTL_SECONDS * 1000,
  );
  const candidates = await listExpiredUnverifiedDcrOAuthApps({
    limit: OAUTH_APP_PRUNE_PAGE_SIZE,
    expiredBefore,
  });

  // A legacy URL-shaped row is deterministically CIMD even if its metadata document is
  // temporarily unavailable. Correct it before lookup so an outage can never make it pruneable.
  const dcrCandidates = await correctLegacyCimdAndKeepDcr(candidates);

  const lookups = await mapInBatches({
    items: dcrCandidates,
    batchSize: OAUTH_CLIENT_RENEWAL_BATCH_SIZE,
    fn: (app) => helpers.lookupClient(app.clientId),
  });
  const missingClientIds = dcrCandidates
    .filter((__app, index) => !lookups[index])
    .map((app) => app.clientId);

  return {
    mirrorsPruned: await deleteUnverifiedDcrOAuthApps(missingClientIds),
    providerSweepComplete: true,
  };
}

// The provider exposes only per-user grant listing; a bounded global scan cannot prove a client
// has no grant. Approval-updated timestamps plus the fixed grant TTL provide that proof instead.
export async function pruneExpiredUnverifiedCimdOAuthApps(
  now = new Date(),
): Promise<{ mirrorsPruned: number; retentionEnabled: boolean }> {
  if (OAUTH_UNVERIFIED_CIMD_RETENTION_SECONDS === undefined) {
    return { mirrorsPruned: 0, retentionEnabled: false };
  }

  const inactiveBefore = new Date(
    now.getTime() - OAUTH_UNVERIFIED_CIMD_RETENTION_SECONDS * 1000,
  );
  const candidates = await listExpiredUnverifiedCimdOAuthApps({
    limit: OAUTH_APP_PRUNE_PAGE_SIZE,
    inactiveBefore,
  });

  return {
    mirrorsPruned: await deleteExpiredUnverifiedCimdOAuthApps({
      clientIds: candidates.map((app) => app.clientId),
      inactiveBefore,
    }),
    retentionEnabled: true,
  };
}
