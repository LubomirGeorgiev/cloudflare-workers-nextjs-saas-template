import { describe, expect, test, vi } from "vitest";

import {
  CMS_CACHE_PURGE_OK,
  CMS_PURGE_STATUS,
  WORKERS_CACHE_PURGE_OUTCOME,
} from "@/constants/cache-purge";
import { EDGE_HTML_ZONE_PURGE_OUTCOME } from "@/constants/edge-html-cache";

vi.mock("server-only", () => ({}));

const {
  hasCmsCachePurgeFailed,
  reportCmsCachePurge,
  selectCmsCachePurgeOutcome,
  withCmsCachePurgeReport,
} = await import("./cms-cache-purge-report");

const ZONE_FAILED = { ...CMS_CACHE_PURGE_OK, zone: CMS_PURGE_STATUS.FAILED };
const ZONE_UNCONFIGURED = { ...CMS_CACHE_PURGE_OK, zone: CMS_PURGE_STATUS.UNCONFIGURED };
const WORKERS_CACHE_FAILED = { ...CMS_CACHE_PURGE_OK, workersCache: CMS_PURGE_STATUS.FAILED };

describe("CMS cache purge report", () => {
  test("adds the outcome to the action result, and the result passes through", async () => {
    const result = await withCmsCachePurgeReport(async () => {
      reportCmsCachePurge(ZONE_FAILED);
      return { id: "entry" };
    });

    expect(result).toEqual({ id: "entry", cachePurge: ZONE_FAILED });
  });

  test("a write that runs no invalidation reports both kinds as OK", async () => {
    expect(await withCmsCachePurgeReport(async () => ({ success: true }))).toEqual({
      success: true,
      cachePurge: CMS_CACHE_PURGE_OK,
    });
  });

  // A failure of one run must not hide behind a later clean run, and a failure outranks a missing config.
  test("merges every run per kind and keeps the worst status", async () => {
    const result = await withCmsCachePurgeReport(async () => {
      reportCmsCachePurge(ZONE_UNCONFIGURED);
      reportCmsCachePurge(WORKERS_CACHE_FAILED);
      reportCmsCachePurge(CMS_CACHE_PURGE_OK);
      return {};
    });

    expect(result.cachePurge).toEqual({
      zone: CMS_PURGE_STATUS.UNCONFIGURED,
      workersCache: CMS_PURGE_STATUS.FAILED,
    });
  });

  // The queue and the API run the same pipeline with nobody to tell.
  test("a report outside a scope is ignored", () => {
    expect(() => reportCmsCachePurge(ZONE_FAILED)).not.toThrow();
  });

  // One editor's failed purge must not show on another editor's save in the same isolate.
  test("concurrent writes keep their own report", async () => {
    let releaseFailedWrite = () => {};
    const failedWriteHeld = new Promise<void>((resolve) => {
      releaseFailedWrite = resolve;
    });

    const [failed, clean] = await Promise.all([
      withCmsCachePurgeReport(async () => {
        await failedWriteHeld;
        reportCmsCachePurge(ZONE_FAILED);
        return {};
      }),
      withCmsCachePurgeReport(async () => {
        reportCmsCachePurge(CMS_CACHE_PURGE_OK);
        releaseFailedWrite();
        return {};
      }),
    ]);

    expect(failed.cachePurge).toEqual(ZONE_FAILED);
    expect(clean.cachePurge).toEqual(CMS_CACHE_PURGE_OK);
  });

  test("maps each raw outcome to one CMS status", () => {
    expect(selectCmsCachePurgeOutcome({
      zonePurge: EDGE_HTML_ZONE_PURGE_OUTCOME.NONE,
      workersCachePurge: WORKERS_CACHE_PURGE_OUTCOME.OK,
    })).toEqual(CMS_CACHE_PURGE_OK);
    expect(selectCmsCachePurgeOutcome({
      zonePurge: EDGE_HTML_ZONE_PURGE_OUTCOME.UNCONFIGURED,
      workersCachePurge: WORKERS_CACHE_PURGE_OUTCOME.SKIPPED_UNAVAILABLE,
    })).toEqual({ zone: CMS_PURGE_STATUS.UNCONFIGURED, workersCache: CMS_PURGE_STATUS.UNCONFIGURED });
    expect(selectCmsCachePurgeOutcome({
      zonePurge: EDGE_HTML_ZONE_PURGE_OUTCOME.FAILED,
      workersCachePurge: WORKERS_CACHE_PURGE_OUTCOME.FAILED,
    })).toEqual({ zone: CMS_PURGE_STATUS.FAILED, workersCache: CMS_PURGE_STATUS.FAILED });
  });

  // The delayed job retries on this answer, so a missing config must not count: it never heals.
  test("only a purge that ran and failed counts as failed", () => {
    expect(hasCmsCachePurgeFailed(ZONE_FAILED)).toBe(true);
    expect(hasCmsCachePurgeFailed(WORKERS_CACHE_FAILED)).toBe(true);
    expect(hasCmsCachePurgeFailed(ZONE_UNCONFIGURED)).toBe(false);
    expect(hasCmsCachePurgeFailed(CMS_CACHE_PURGE_OK)).toBe(false);
  });
});
