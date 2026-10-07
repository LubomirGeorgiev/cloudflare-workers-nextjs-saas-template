import { describe, expect, test } from "vitest";

import { CMS_CACHE_PURGE_OK, CMS_PURGE_STATUS } from "@/constants/cache-purge";

import { selectCmsPurgeWarning, stashReloadToast, takeReloadToast } from "./zone-purge-warning";

const SUCCESS_MESSAGE = "Entry reverted successfully";
const RELOAD_TOAST = { successMessage: SUCCESS_MESSAGE, cachePurge: CMS_CACHE_PURGE_OK };
const ZONE_FAILED = { ...CMS_CACHE_PURGE_OK, zone: CMS_PURGE_STATUS.FAILED };
const ZONE_UNCONFIGURED = { ...CMS_CACHE_PURGE_OK, zone: CMS_PURGE_STATUS.UNCONFIGURED };
const WORKERS_CACHE_FAILED = { ...CMS_CACHE_PURGE_OK, workersCache: CMS_PURGE_STATUS.FAILED };
const OLD_PAGE_LOAD_ID = "1000.5";
const NEW_PAGE_LOAD_ID = "2000.5";

function memoryStorage() {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

function throwingStorage() {
  const fail = () => {
    throw new Error("storage blocked");
  };

  return { getItem: fail, setItem: fail, removeItem: fail };
}

describe("reload toast handoff", () => {
  test("the next page reads the stashed message once", () => {
    const storage = memoryStorage();

    stashReloadToast({ storage, pageLoadId: OLD_PAGE_LOAD_ID, reloadToast: RELOAD_TOAST });

    expect(takeReloadToast({ storage, pageLoadId: NEW_PAGE_LOAD_ID })).toEqual(RELOAD_TOAST);
    // A second reload must not show the toast again.
    expect(takeReloadToast({ storage, pageLoadId: NEW_PAGE_LOAD_ID })).toBeNull();
  });

  // The RSC refresh of the server action runs the effect again on the old page before the reload.
  test("the page that stashed the message leaves it for the next page", () => {
    const storage = memoryStorage();

    stashReloadToast({ storage, pageLoadId: OLD_PAGE_LOAD_ID, reloadToast: RELOAD_TOAST });

    expect(takeReloadToast({ storage, pageLoadId: OLD_PAGE_LOAD_ID })).toBeNull();
    expect(takeReloadToast({ storage, pageLoadId: NEW_PAGE_LOAD_ID })).toEqual(RELOAD_TOAST);
  });

  // A revert or re-translate reloads the page, so the purge outcome must reach the next page.
  test("the next page reads the purge outcome from the stash", () => {
    const storage = memoryStorage();
    const failed = { successMessage: SUCCESS_MESSAGE, cachePurge: ZONE_FAILED };

    stashReloadToast({ storage, pageLoadId: OLD_PAGE_LOAD_ID, reloadToast: failed });

    expect(takeReloadToast({ storage, pageLoadId: NEW_PAGE_LOAD_ID })).toEqual(failed);
  });

  // A tab can hold a stash from another build, with no outcome or an outcome of another shape.
  test("a stash without a known outcome keeps the message and shows no warning", () => {
    const storage = memoryStorage();

    for (const cachePurge of [undefined, true, { zone: "broken", workersCache: "ok" }]) {
      storage.setItem(
        "cms-write-reload-toast",
        JSON.stringify({ pageLoadId: OLD_PAGE_LOAD_ID, successMessage: SUCCESS_MESSAGE, cachePurge }),
      );

      const reloadToast = takeReloadToast({ storage, pageLoadId: NEW_PAGE_LOAD_ID });

      expect(reloadToast).toEqual({ successMessage: SUCCESS_MESSAGE, cachePurge: undefined });
      expect(selectCmsPurgeWarning(reloadToast?.cachePurge)).toBeNull();
    }
  });

  test("a page with nothing stashed shows nothing", () => {
    expect(takeReloadToast({ storage: memoryStorage(), pageLoadId: NEW_PAGE_LOAD_ID })).toBeNull();
  });

  test("a malformed stash shows nothing and is removed", () => {
    const storage = memoryStorage();

    storage.setItem("cms-write-reload-toast", SUCCESS_MESSAGE);

    expect(takeReloadToast({ storage, pageLoadId: NEW_PAGE_LOAD_ID })).toBeNull();
    expect(storage.getItem("cms-write-reload-toast")).toBeNull();
  });

  // A lost toast must never stop the reload or break the next page.
  test("a blocked storage neither throws nor shows a toast", () => {
    const storage = throwingStorage();

    expect(() =>
      stashReloadToast({ storage, pageLoadId: OLD_PAGE_LOAD_ID, reloadToast: RELOAD_TOAST }),
    ).not.toThrow();
    expect(takeReloadToast({ storage, pageLoadId: NEW_PAGE_LOAD_ID })).toBeNull();
  });
});

// The action field alone decides the warning: no separate zone config read can disagree with it.
describe("CMS purge warning", () => {
  test("a clean write and a write with no outcome show no warning", () => {
    expect(selectCmsPurgeWarning(CMS_CACHE_PURGE_OK)).toBeNull();
    expect(selectCmsPurgeWarning(undefined)).toBeNull();
  });

  test("each failed or unconfigured kind shows its own warning", () => {
    const warnings = [ZONE_FAILED, WORKERS_CACHE_FAILED, ZONE_UNCONFIGURED].map(selectCmsPurgeWarning);

    expect(warnings).not.toContain(null);
    expect(new Set(warnings).size).toBe(warnings.length);
  });

  // A retry fixes a failure, so it goes before the config warning that a save cannot fix.
  test("a failure outranks a missing zone config", () => {
    expect(selectCmsPurgeWarning({ zone: CMS_PURGE_STATUS.FAILED, workersCache: CMS_PURGE_STATUS.FAILED }))
      .toBe(selectCmsPurgeWarning(ZONE_FAILED));
    expect(selectCmsPurgeWarning({ ...WORKERS_CACHE_FAILED, zone: CMS_PURGE_STATUS.UNCONFIGURED }))
      .toBe(selectCmsPurgeWarning(WORKERS_CACHE_FAILED));
  });

  // Local workerd has no Workers Caching layer, so there is no edge copy to warn about.
  test("an unavailable Workers Caching purge shows no warning", () => {
    expect(selectCmsPurgeWarning({ ...CMS_CACHE_PURGE_OK, workersCache: CMS_PURGE_STATUS.UNCONFIGURED }))
      .toBeNull();
  });
});
