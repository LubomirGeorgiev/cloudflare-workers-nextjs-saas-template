import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ENABLED_LOCALES } from "@/i18n/config";

import { buildMarkdownPageCacheKey } from "./page-cache";
import { localizedPagePathname } from "./page-paths";

const { kvDeleteMock, kvStore, spans } = vi.hoisted(() => ({
  kvDeleteMock: vi.fn(),
  kvStore: new Set<string>(),
  spans: [] as Array<{ name: string; attributes: Record<string, unknown> }>,
}));

vi.mock("server-only", () => ({}));

vi.mock("cloudflare:workers", () => ({
  env: {
    KV_STORE: {
      delete: kvDeleteMock,
      list: async ({ prefix }: { prefix: string }) => ({
        keys: Array.from(kvStore)
          .filter((key) => key.startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true,
      }),
    },
  },
}));

vi.mock("@/utils/trace", () => ({
  withSpan: ({ name, run }: { name: string; run: (span: unknown) => Promise<unknown> }) => {
    const record = { name, attributes: {} as Record<string, unknown> };
    const span = {
      isTraced: true,
      setAttributes: (values: Record<string, unknown>) => {
        Object.assign(record.attributes, values);
        return span;
      },
    };

    spans.push(record);
    return run(span);
  },
}));

const { purgeMarkdownPageCache } = await import("./purge-page-cache");

const PATHNAME = "/blog";

function pageCacheKey(pathname: string): string {
  return buildMarkdownPageCacheKey({
    pathname: localizedPagePathname({ locale: ENABLED_LOCALES[0], pathname }),
  });
}

describe("purgeMarkdownPageCache span", () => {
  beforeEach(() => {
    kvStore.clear();
    kvDeleteMock.mockReset();
    kvDeleteMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    spans.length = 0;
  });

  test("records the deleted and failed key counts, and a failed delete does not reject", async () => {
    const keys = [pageCacheKey(PATHNAME), pageCacheKey(`${PATHNAME}/one`), pageCacheKey(`${PATHNAME}/two`)];
    for (const key of keys) {
      kvStore.add(key);
    }
    kvDeleteMock.mockRejectedValueOnce(new Error("kv unavailable"));

    await expect(purgeMarkdownPageCache({ pathnames: [PATHNAME] })).resolves.toBeUndefined();

    expect(kvDeleteMock).toHaveBeenCalledTimes(keys.length);
    expect(spans).toEqual([{
      name: "app.cms.markdown_purge",
      attributes: {
        "app.cms.keys_deleted": keys.length - 1,
        "app.cms.keys_failed": 1,
      },
    }]);
  });

  test("records zero counts when no key is cached", async () => {
    await purgeMarkdownPageCache({ pathnames: [PATHNAME] });

    expect(spans[0]?.attributes).toEqual({
      "app.cms.keys_deleted": 0,
      "app.cms.keys_failed": 0,
    });
  });
});
