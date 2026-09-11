import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CMS_ICON_NAMES_PER_SET_REQUEST, CMS_ICON_SEARCH_RESULTS_PER_SET } from "@/constants";
import { CMS_ICON_SET_PREFIXES } from "@/constants/cms-icons";

vi.mock("server-only", () => ({}));

const kvPuts: Array<{ key: string; value: string }> = [];
const kvGet = vi.fn(async () => null);

vi.mock("cloudflare:workers", () => ({
  env: {
    ICONIFY_API_ORIGIN: "https://api.iconify.design",
    KV_STORE: {
      get: () => kvGet(),
      put: async (key: string, value: string) => {
        kvPuts.push({ key, value });
      },
    },
  },
}));

const { fetchIconBodies, requireIconBodies, searchIcons } = await import("./cms-icons");

const LUCIDE_HOUSE = '<path fill="currentColor" d="M3 10l9-7l9 7"/>';

function iconNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `icon-${index}`);
}

function lucideDocument(names: string[]) {
  return Response.json({
    prefix: "lucide",
    width: 24,
    height: 24,
    icons: Object.fromEntries(names.map((name) => [name, { body: LUCIDE_HOUSE }])),
  });
}

function requestedNames(url: string): string[] {
  return new URL(url).searchParams.get("icons")?.split(",") ?? [];
}

beforeEach(() => {
  kvPuts.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchIconBodies", () => {
  test("one set's names split into chunked requests instead of one long query string", async () => {
    const names = iconNames(CMS_ICON_NAMES_PER_SET_REQUEST + 1);
    const fetchMock = vi.fn(async (url: string) => lucideDocument(requestedNames(url)));
    vi.stubGlobal("fetch", fetchMock);

    const bodies = await fetchIconBodies({ keys: names.map((name) => `lucide:${name}`) });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => requestedNames(url).length)).toEqual([
      CMS_ICON_NAMES_PER_SET_REQUEST,
      1,
    ]);
    expect(bodies.size).toBe(names.length);
  });

  test("a name the set does not hold is absent rather than thrown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => lucideDocument(["house"])));

    const bodies = await fetchIconBodies({ keys: ["lucide:house", "lucide:gone"] });

    expect(Array.from(bodies.keys())).toEqual(["lucide:house"]);
  });

  test("markup the sanitizer refuses never reaches a caller", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      prefix: "lucide",
      icons: { house: { body: '<path d="M3 10" onload="steal()"/>' } },
    })));

    await expect(fetchIconBodies({ keys: ["lucide:house"] })).resolves.toEqual(new Map());
  });
});

describe("requireIconBodies", () => {
  test("a key the icon service cannot answer for refuses the whole call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => lucideDocument(["house"])));

    await expect(requireIconBodies({ keys: ["lucide:house", "lucide:gone"] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("searchIcons", () => {
  test("the cache key covers the set list, the per-set limit, and the lowercased query", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (
      url.includes("/search?")
        ? Response.json({ icons: ["lucide:house"] })
        : lucideDocument(["house"])
    )));

    await searchIcons({ query: "House" });

    expect(kvPuts).toHaveLength(1);
    expect(kvPuts[0].key).toContain(CMS_ICON_SET_PREFIXES.join(","));
    expect(kvPuts[0].key).toContain(`|${CMS_ICON_SEARCH_RESULTS_PER_SET}|house`);
  });
});
