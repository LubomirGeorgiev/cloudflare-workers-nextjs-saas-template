/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  CMS_ICON_SEARCH_CACHE_TTL_SECONDS,
  CMS_ICON_SEARCH_RESULTS_PER_SET,
} from "@/constants";
import { CMS_ICON_SET_PREFIXES } from "@/constants/cms-icons";
import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";
import { fetchIconBodies, requireIconBodies, searchIcons } from "@/lib/cms/cms-icons";

// What `resolveSetIcon` builds around an Iconify body: one complete document, the same shape an
// uploaded file is stored in.
const svgDocument = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`;
const LUCIDE_HOUSE =
  '<path fill="none" stroke="currentColor" stroke-width="2" d="M3 10l9-7l9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>';
const TABLER_HOME = '<path fill="currentColor" d="M5 12l-2 0l9-9l9 9l-2 0"/>';

const fetchMock = vi.fn();

function iconifyResponse(body: unknown) {
  return Response.json(body);
}

// The set document Iconify answers a `/{prefix}.json?icons=...` request with.
function lucideSetDocument(icons: Record<string, { body: string }>) {
  return {
    prefix: "lucide",
    width: 24,
    height: 24,
    aliases: { home: { parent: "house" } },
    icons,
  };
}

async function clearIconSearchCache() {
  const { keys } = await env.KV_STORE.list({ prefix: APP_KV_PREFIXES.cmsIconSearch });
  await Promise.all(keys.map((key) => env.KV_STORE.delete(key.name)));
}

beforeEach(async () => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  await clearIconSearchCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("one search call covers every set, then one document call per set that matched", async () => {
  fetchMock
    .mockResolvedValueOnce(iconifyResponse({ icons: ["lucide:house", "tabler:home"] }))
    .mockResolvedValueOnce(iconifyResponse(lucideSetDocument({ house: { body: LUCIDE_HOUSE } })))
    .mockResolvedValueOnce(iconifyResponse({
      prefix: "tabler",
      width: 24,
      height: 24,
      icons: { home: { body: TABLER_HOME } },
    }));

  const groups = await searchIcons({ query: "home" });

  expect(groups).toEqual([
    { prefix: "lucide", icons: [{ key: "lucide:house", markup: svgDocument(LUCIDE_HOUSE) }] },
    { prefix: "tabler", icons: [{ key: "tabler:home", markup: svgDocument(TABLER_HOME) }] },
  ]);
  // One `/search` for all sets, then one document per matched set — never one request per icon.
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls[0][0]).toContain(
    `prefixes=${CMS_ICON_SET_PREFIXES.join(",")}`,
  );
});

test("groups follow the configured set order, and a set with no match is dropped", async () => {
  // Answers by URL, so the assertion is about group order and not about request order.
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/search")) {
      return iconifyResponse({ icons: ["tabler:home", "lucide:house"] });
    }

    return iconifyResponse(
      url.includes("/tabler.json")
        ? { prefix: "tabler", width: 24, height: 24, icons: { home: { body: TABLER_HOME } } }
        : lucideSetDocument({ house: { body: LUCIDE_HOUSE } }),
    );
  });

  const groups = await searchIcons({ query: "ordered" });

  // `lucide` precedes `tabler` in CMS_ICON_SET_PREFIXES, whatever order the search answered in.
  expect(groups.map(({ prefix }) => prefix)).toEqual(["lucide", "tabler"]);
});

test("a set contributes at most its share, trimmed before any body is fetched", async () => {
  const names = Array.from({ length: 20 }, (unused, index) => `icon-${index}`);
  fetchMock
    .mockResolvedValueOnce(iconifyResponse({ icons: names.map((name) => `lucide:${name}`) }))
    .mockResolvedValueOnce(iconifyResponse(lucideSetDocument(
      Object.fromEntries(names.map((name) => [name, { body: LUCIDE_HOUSE }])),
    )));

  const groups = await searchIcons({ query: "many" });

  expect(groups[0].icons).toHaveLength(CMS_ICON_SEARCH_RESULTS_PER_SET);
  // The trim happens before the document call, so the untrimmed names never reach the URL.
  expect(fetchMock.mock.calls[1][0]).not.toContain("icon-19");
});

test("a repeated search is answered from KV without an outbound request", async () => {
  fetchMock
    .mockResolvedValueOnce(iconifyResponse({ icons: ["lucide:house"] }))
    .mockResolvedValueOnce(iconifyResponse(lucideSetDocument({ house: { body: LUCIDE_HOUSE } })));

  const first = await searchIcons({ query: "house" });
  fetchMock.mockReset();
  const second = await searchIcons({ query: "house" });

  expect(second).toEqual(first);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("every search cache key carries a TTL", async () => {
  fetchMock
    .mockResolvedValueOnce(iconifyResponse({ icons: ["lucide:house"] }))
    .mockResolvedValueOnce(iconifyResponse(lucideSetDocument({ house: { body: LUCIDE_HOUSE } })));

  const writtenAt = Math.floor(Date.now() / 1000);
  await searchIcons({ query: "ttl" });

  const { keys } = await env.KV_STORE.list({ prefix: APP_KV_PREFIXES.cmsIconSearch });
  expect(keys).toHaveLength(1);
  expect(keys[0].expiration).toBeGreaterThan(writtenAt);
  expect(keys[0].expiration).toBeLessThanOrEqual(writtenAt + CMS_ICON_SEARCH_CACHE_TTL_SECONDS + 5);
});

test("an alias key resolves to its parent's body", async () => {
  fetchMock.mockResolvedValueOnce(
    iconifyResponse(lucideSetDocument({ house: { body: LUCIDE_HOUSE } })),
  );

  const bodies = await fetchIconBodies({ keys: ["lucide:home"] });

  expect(bodies.get("lucide:home")).toEqual({ markup: svgDocument(LUCIDE_HOUSE) });
});

test("a key the set does not hold is absent from a lookup and fails a save", async () => {
  const missingSetDocument = () => iconifyResponse({
    prefix: "lucide",
    width: 24,
    height: 24,
    icons: {},
    not_found: ["not-real"],
  });
  fetchMock.mockResolvedValueOnce(missingSetDocument());

  await expect(fetchIconBodies({ keys: ["lucide:not-real"] })).resolves.toEqual(new Map());

  fetchMock.mockResolvedValueOnce(missingSetDocument());

  await expect(requireIconBodies({ keys: ["lucide:not-real"] })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

test("a prefix outside the licensed catalog is refused before any request", async () => {
  await expect(fetchIconBodies({ keys: ["some-set:thing"] })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("an unreachable icon service fails the lookup instead of returning nothing", async () => {
  fetchMock.mockRejectedValueOnce(new Error("network down"));

  await expect(fetchIconBodies({ keys: ["lucide:house"] })).rejects.toMatchObject({
    code: "SERVICE_UNAVAILABLE",
  });
});

test("a search drops an icon it cannot render and still returns the rest", async () => {
  fetchMock
    .mockResolvedValueOnce(iconifyResponse({ icons: ["lucide:house", "lucide:gradient"] }))
    .mockResolvedValueOnce(iconifyResponse(lucideSetDocument({
      house: { body: LUCIDE_HOUSE },
      gradient: { body: '<path fill="url(#g)" d="M0 0"/>' },
    })));

  const groups = await searchIcons({ query: "mixed" });

  expect(groups[0].icons.map(({ key }) => key)).toEqual(["lucide:house"]);
});

test("markup the sanitizer refuses never becomes a stored body", async () => {
  fetchMock.mockResolvedValueOnce(iconifyResponse(
    lucideSetDocument({ house: { body: '<path d="M0 0"/><script>alert(1)</script>' } }),
  ));

  // Refused markup leaves the key unanswered, which is what a save refuses on: one rule for "the
  // set does not hold it" and "we will not inline it", so neither can be written half-way.
  await expect(requireIconBodies({ keys: ["lucide:house"] })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
