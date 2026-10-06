import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import {
  CMS_CACHE_PURGE_OK,
  CMS_PURGE_STATUS,
  WORKERS_CACHE_PURGE_OUTCOME,
  type CmsCachePurgeOutcome,
  type CmsPurgeStatus,
  type WorkersCachePurgeOutcome,
} from "@/constants/cache-purge";
import {
  EDGE_HTML_ZONE_PURGE_OUTCOME,
  type EdgeHtmlZonePurgeOutcome,
} from "@/constants/edge-html-cache";

// One scope per server action, so a failure in one editor's save never shows on another concurrent
// save. The scope keeps the CMS mutation signatures unchanged; other callers read the return value.
const reportStorage = new AsyncLocalStorage<CmsCachePurgeReport>();

// A merge keeps the worst status: a failure outranks a missing config, and both outrank success.
const STATUS_RANK: Record<CmsPurgeStatus, number> = {
  [CMS_PURGE_STATUS.OK]: 0,
  [CMS_PURGE_STATUS.UNCONFIGURED]: 1,
  [CMS_PURGE_STATUS.FAILED]: 2,
};

/**
 * Runs the body of a CMS server action and adds `cachePurge` to its result: the merged outcome of
 * every CMS invalidation inside the body. With no invalidation, both kinds are `OK`.
 */
export async function withCmsCachePurgeReport<T extends object>(
  write: () => Promise<T>,
): Promise<T & { cachePurge: CmsCachePurgeOutcome }> {
  const report: CmsCachePurgeReport = { outcome: CMS_CACHE_PURGE_OK };
  const result = await reportStorage.run(report, write);

  return { ...result, cachePurge: report.outcome };
}

/** Called by `runCmsCacheInvalidation` and by a direct purge in an action. Outside a scope it does nothing. */
export function reportCmsCachePurge(outcome: CmsCachePurgeOutcome): void {
  const report = reportStorage.getStore();

  if (report) {
    report.outcome = {
      zone: selectWorseStatus([report.outcome.zone, outcome.zone]),
      workersCache: selectWorseStatus([report.outcome.workersCache, outcome.workersCache]),
    };
  }
}

/** Maps the raw outcome of each purge kind to the one CMS outcome. */
export function selectCmsCachePurgeOutcome({
  zonePurge,
  workersCachePurge,
}: {
  zonePurge: EdgeHtmlZonePurgeOutcome;
  workersCachePurge: WorkersCachePurgeOutcome;
}): CmsCachePurgeOutcome {
  return {
    zone: ZONE_PURGE_STATUS[zonePurge],
    workersCache: WORKERS_CACHE_PURGE_STATUS[workersCachePurge],
  };
}

/** True when a purge ran and failed. A retry can fix that; it cannot fix a missing config. */
export function hasCmsCachePurgeFailed(outcome: CmsCachePurgeOutcome): boolean {
  return outcome.zone === CMS_PURGE_STATUS.FAILED
    || outcome.workersCache === CMS_PURGE_STATUS.FAILED;
}

function selectWorseStatus(statuses: [CmsPurgeStatus, CmsPurgeStatus]): CmsPurgeStatus {
  const [first, second] = statuses;

  return STATUS_RANK[second] > STATUS_RANK[first] ? second : first;
}

const ZONE_PURGE_STATUS: Record<EdgeHtmlZonePurgeOutcome, CmsPurgeStatus> = {
  [EDGE_HTML_ZONE_PURGE_OUTCOME.FAILED]: CMS_PURGE_STATUS.FAILED,
  [EDGE_HTML_ZONE_PURGE_OUTCOME.NONE]: CMS_PURGE_STATUS.OK,
  [EDGE_HTML_ZONE_PURGE_OUTCOME.OK]: CMS_PURGE_STATUS.OK,
  [EDGE_HTML_ZONE_PURGE_OUTCOME.UNCONFIGURED]: CMS_PURGE_STATUS.UNCONFIGURED,
};

const WORKERS_CACHE_PURGE_STATUS: Record<WorkersCachePurgeOutcome, CmsPurgeStatus> = {
  [WORKERS_CACHE_PURGE_OUTCOME.FAILED]: CMS_PURGE_STATUS.FAILED,
  [WORKERS_CACHE_PURGE_OUTCOME.OK]: CMS_PURGE_STATUS.OK,
  [WORKERS_CACHE_PURGE_OUTCOME.SKIPPED_UNAVAILABLE]: CMS_PURGE_STATUS.UNCONFIGURED,
};

interface CmsCachePurgeReport {
  outcome: CmsCachePurgeOutcome;
}
