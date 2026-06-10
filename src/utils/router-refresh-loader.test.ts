import { describe, expect, test, vi } from "vitest";

import { patchRouterRefreshForLoader } from "./router-refresh-loader";

describe("patchRouterRefreshForLoader", () => {
  test("keeps router refresh scoped to loader state and the original refresh", () => {
    const start = vi.fn();
    const originalRefresh = vi.fn();
    const router = {
      refresh: originalRefresh,
    };

    const restore = patchRouterRefreshForLoader({ router, start });

    router.refresh();

    expect(start).toHaveBeenCalledOnce();
    expect(originalRefresh).toHaveBeenCalledOnce();

    restore();

    expect(router.refresh).toBe(originalRefresh);
  });
});
