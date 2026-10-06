// Import-free, so a client component and the Workers Caching fallback path can read these values
// without the purge module, which imports `cloudflare:workers`.

// What one Workers Caching purge did.
export const WORKERS_CACHE_PURGE_OUTCOME = {
  OK: "ok",
  FAILED: "failed",
  SKIPPED_UNAVAILABLE: "skipped_unavailable",
} as const;

export type WorkersCachePurgeOutcome =
  (typeof WORKERS_CACHE_PURGE_OUTCOME)[keyof typeof WORKERS_CACHE_PURGE_OUTCOME];

// The status of one purge kind after a CMS write. `OK` also covers "nothing to send".
export const CMS_PURGE_STATUS = {
  OK: "ok",
  FAILED: "failed",
  // The purge cannot run here: no zone credentials, or no `cache.purge` in local workerd.
  UNCONFIGURED: "unconfigured",
} as const;

export type CmsPurgeStatus = (typeof CMS_PURGE_STATUS)[keyof typeof CMS_PURGE_STATUS];

/** The one purge outcome of a CMS invalidation: the zone HTML purge and the Workers Caching purge. */
export interface CmsCachePurgeOutcome {
  zone: CmsPurgeStatus;
  workersCache: CmsPurgeStatus;
}

export const CMS_CACHE_PURGE_OK: CmsCachePurgeOutcome = {
  zone: CMS_PURGE_STATUS.OK,
  workersCache: CMS_PURGE_STATUS.OK,
};
