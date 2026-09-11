import "server-only";

import { env as workerEnv } from "cloudflare:workers";

import {
  CMS_ICON_NAMES_PER_SET_REQUEST,
  CMS_ICON_SEARCH_CACHE_TTL_SECONDS,
  CMS_ICON_SEARCH_RESULTS_PER_SET,
} from "@/constants";
import { CMS_ICON_SET_PREFIXES } from "@/constants/cms-icons";
import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";
import { ActionError } from "@/lib/action-error";
import {
  groupIconKeysBySet,
  parseIconKey,
  resolveSetIcon,
  type CmsIconSearchGroup,
  type IconifySetResponse,
} from "@/lib/cms/cms-icon-rules";
import type { CmsIconBody } from "@/types/cms-navigation";
import { chunk } from "@/utils/chunk";
import { mapInBatches } from "@/utils/map-in-batches";

// The widest `limit` the Iconify search accepts. At this width the response is the complete match
// set, not a ranked slice of it, which is what lets one call fill every group fairly.
const ICONIFY_MAX_SEARCH_LIMIT = 999;
// Document requests in flight at once. The whole fan-out is bounded by the node cap divided by
// `CMS_ICON_NAMES_PER_SET_REQUEST`, so this only paces it inside the subrequest budget.
const ICON_DOCUMENT_REQUEST_BATCH_SIZE = 6;

interface IconifySearchResponse {
  icons?: string[];
}

function getIconifyOrigin(): string {
  return workerEnv.ICONIFY_API_ORIGIN.replace(/\/+$/, "");
}

async function fetchIconifyJson<T>(path: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${getIconifyOrigin()}${path}`, {
      headers: { accept: "application/json" },
    });
  } catch {
    throw new ActionError("SERVICE_UNAVAILABLE", "The icon service could not be reached.");
  }

  if (!response.ok) {
    throw new ActionError("SERVICE_UNAVAILABLE", "The icon service returned an error.");
  }

  return (await response.json()) as T;
}

/**
 * The bodies behind a set of `{prefix}:{name}` keys, keyed by the key. One request per chunk of
 * names in a set — never one request per icon. A key we cannot render is absent from the result;
 * a transport failure throws, so an outage never looks like an empty answer.
 *
 * The chunk exists because the names ride in the query string: a first icon rollout over a full
 * tree would otherwise build one `icons=` list past the URL limit common proxies apply.
 */
export async function fetchIconBodies({ keys }: { keys: string[] }): Promise<Map<string, CmsIconBody>> {
  const namesByPrefix = new Map<string, Set<string>>();

  for (const key of new Set(keys)) {
    const { prefix, name } = parseIconKey(key);
    const names = namesByPrefix.get(prefix) ?? new Set<string>();
    names.add(name);
    namesByPrefix.set(prefix, names);
  }

  const requests = Array.from(namesByPrefix).flatMap(([prefix, names]) =>
    chunk({ items: Array.from(names), size: CMS_ICON_NAMES_PER_SET_REQUEST })
      .map((chunkedNames) => ({ prefix, names: chunkedNames })),
  );

  const documents = await mapInBatches({
    items: requests,
    batchSize: ICON_DOCUMENT_REQUEST_BATCH_SIZE,
    fn: async ({ prefix, names }) => ({
      prefix,
      names,
      document: await fetchIconifyJson<IconifySetResponse>(
        `/${prefix}.json?icons=${names.map(encodeURIComponent).join(",")}`,
      ),
    }),
  });

  const bodies = new Map<string, CmsIconBody>();

  for (const { prefix, names, document } of documents) {
    for (const name of names) {
      const icon = resolveSetIcon({ document, name });

      if (icon) {
        bodies.set(`${prefix}:${name}`, icon);
      }
    }
  }

  return bodies;
}

/**
 * `fetchIconBodies` for a save: an admin who picked an icon has to learn it was not stored, so a
 * key the icon service cannot answer for refuses the whole save rather than writing a blank row.
 */
export async function requireIconBodies({ keys }: { keys: string[] }): Promise<Map<string, CmsIconBody>> {
  const bodies = await fetchIconBodies({ keys });
  const missing = keys.filter((key) => !bodies.has(key));

  if (missing.length > 0) {
    throw new ActionError("NOT_FOUND", `We cannot use these icons: ${missing.join(", ")}.`);
  }

  return bodies;
}

// Everything that varies the stored groups: which sets are searched, how many icons each one
// contributes, and the query itself. A fork that edits either constant reads a fresh key instead
// of the old grouping for the rest of the TTL.
function buildIconSearchCacheKey(query: string): string {
  return `${APP_KV_PREFIXES.cmsIconSearch}`
    + `${CMS_ICON_SET_PREFIXES.join(",")}|${CMS_ICON_SEARCH_RESULTS_PER_SET}|${query.toLowerCase()}`;
}

async function readCachedIconSearch(cacheKey: string): Promise<CmsIconSearchGroup[] | null> {
  try {
    return await workerEnv.KV_STORE.get<CmsIconSearchGroup[]>(cacheKey, "json") ?? null;
  } catch {
    // A cache that cannot be read is a cold cache; the Iconify call below still answers.
    return null;
  }
}

async function writeCachedIconSearch(
  cacheKey: string,
  groups: CmsIconSearchGroup[],
): Promise<void> {
  try {
    await workerEnv.KV_STORE.put(cacheKey, JSON.stringify(groups), {
      expirationTtl: CMS_ICON_SEARCH_CACHE_TTL_SECONDS,
    });
  } catch {
    // Never fail a search the admin already has an answer for.
  }
}

/**
 * Icons matching `query`, with their sanitized bodies, grouped by icon set for the admin picker.
 *
 * One search call covers every set. It asks for the widest limit because a narrower one truncates
 * a globally ranked list — at `limit=64`, "home" comes back as 26 Material Symbols and 1 Lucide,
 * and the smaller sets vanish. Trimming per set happens here, before any body is fetched, so the
 * whole search costs one search request plus one document request per set that matched.
 */
export async function searchIcons({ query }: { query: string }): Promise<CmsIconSearchGroup[]> {
  const cacheKey = buildIconSearchCacheKey(query);
  const cached = await readCachedIconSearch(cacheKey);

  if (cached) {
    return cached;
  }

  const search = await fetchIconifyJson<IconifySearchResponse>(
    `/search?query=${encodeURIComponent(query)}`
      + `&limit=${ICONIFY_MAX_SEARCH_LIMIT}&prefixes=${CMS_ICON_SET_PREFIXES.join(",")}`,
  );
  const keysByPrefix = groupIconKeysBySet(search.icons ?? []);
  const bodies = await fetchIconBodies({
    keys: Array.from(keysByPrefix.values()).flat(),
  });

  // `CMS_ICON_SET_PREFIXES` order, so the picker groups the same way on every search.
  const groups = CMS_ICON_SET_PREFIXES.flatMap((prefix) => {
    const icons = (keysByPrefix.get(prefix) ?? []).flatMap((key) => {
      const icon = bodies.get(key);
      return icon ? [{ key, ...icon }] : [];
    });

    return icons.length > 0 ? [{ prefix, icons }] : [];
  });

  await writeCachedIconSearch(cacheKey, groups);

  return groups;
}
