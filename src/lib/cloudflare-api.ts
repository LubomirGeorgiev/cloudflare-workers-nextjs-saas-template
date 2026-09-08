import "server-only";

import { env as workerEnv } from "cloudflare:workers";

import { SITE_DOMAIN, ZONE_PURGE_TAGS_PER_REQUEST } from "@/constants";
import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";
import { lazyValue } from "@/utils/lazy-value";

const DEFAULT_CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";

// The zone id survives isolate churn in KV, so only the first cold isolate of the day spends a
// Cloudflare API call on the lookup. A TTL rather than a permanent key: the answer can change when
// the domain moves to another zone, and without one a stale id would break every purge forever.
const WORKER_ZONE_ID_CACHE_TTL_SECONDS = 24 * 60 * 60;
const WORKER_ZONE_ID_CACHE_KEY = `${APP_KV_PREFIXES.workerZone}${SITE_DOMAIN}`;

interface CloudflareApiClientOptions {
  apiToken: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

interface CloudflareApiMessage {
  code: number;
  message: string;
}

interface CloudflareApiResultInfo {
  count: number;
  page: number;
  per_page: number;
  total_count: number;
  total_pages: number;
}

interface CloudflareApiResponse<Result> {
  errors: CloudflareApiMessage[];
  messages: CloudflareApiMessage[];
  result: Result;
  result_info?: CloudflareApiResultInfo;
  success: boolean;
}

type CloudflareApiQueryValue = boolean | number | string | undefined;

interface CloudflareApiRequestOptions<Body = unknown> {
  body?: Body;
  method?: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  path: string;
  query?: Record<string, CloudflareApiQueryValue>;
}

interface CloudflareApiClient {
  paginate<Item>(options: CloudflareApiRequestOptions): AsyncGenerator<Item>;
  request<Result, Body = unknown>(
    options: CloudflareApiRequestOptions<Body>,
  ): Promise<CloudflareApiResponse<Result>>;
}

class CloudflareApiError extends Error {
  readonly errors: CloudflareApiMessage[];
  readonly messages: CloudflareApiMessage[];
  readonly response?: CloudflareApiResponse<unknown>;
  readonly status: number;

  constructor({
    errors,
    fallbackMessage,
    messages,
    response,
    status,
  }: {
    errors?: CloudflareApiMessage[];
    fallbackMessage: string;
    messages?: CloudflareApiMessage[];
    response?: CloudflareApiResponse<unknown>;
    status: number;
  }) {
    super(getCloudflareApiErrorMessage({
      errors,
      fallbackMessage,
    }));
    this.name = "CloudflareApiError";
    this.errors = errors ?? [];
    this.messages = messages ?? [];
    this.response = response;
    this.status = status;
  }
}

let cachedClient: CloudflareApiClient | null = null;
let cachedApiToken: string | null = null;

function getCloudflareApiErrorMessage({
  errors,
  fallbackMessage,
}: {
  errors?: CloudflareApiMessage[];
  fallbackMessage: string;
}): string {
  if (errors?.length) {
    return errors
      .map((apiError) => `${apiError.code}: ${apiError.message}`)
      .join("; ");
  }

  return fallbackMessage;
}

function getApiUrl({
  baseUrl,
  path,
  query,
}: {
  baseUrl: string;
  path: string;
  query?: Record<string, CloudflareApiQueryValue>;
}): URL {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(normalizedPath, normalizedBaseUrl);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

async function readCloudflareApiResponse<Result>({
  response,
}: {
  response: Response;
}): Promise<CloudflareApiResponse<Result>> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    throw new CloudflareApiError({
      fallbackMessage: `Cloudflare API returned ${response.status} ${response.statusText}.`,
      status: response.status,
    });
  }

  const envelope = await response.json() as CloudflareApiResponse<Result>;

  if (!response.ok || !envelope.success) {
    throw new CloudflareApiError({
      errors: envelope.errors,
      fallbackMessage: `Cloudflare API returned ${response.status} ${response.statusText}.`,
      messages: envelope.messages,
      response: envelope as CloudflareApiResponse<unknown>,
      status: response.status,
    });
  }

  return envelope;
}

export function isCloudflareApiError(error: unknown): error is CloudflareApiError {
  return error instanceof CloudflareApiError;
}

export function createCloudflareApiClient({
  apiToken,
  baseUrl = DEFAULT_CLOUDFLARE_API_BASE_URL,
  fetcher = fetch,
}: CloudflareApiClientOptions): CloudflareApiClient {
  const trimmedApiToken = apiToken.trim();

  if (!trimmedApiToken) {
    throw new Error("CLOUDFLARE_API_TOKEN is not configured.");
  }

  const request: CloudflareApiClient["request"] = async <Result, Body = unknown>({
    body,
    method = body === undefined ? "GET" : "POST",
    path,
    query,
  }: CloudflareApiRequestOptions<Body>) => {
    const headers = new Headers({
      authorization: `Bearer ${trimmedApiToken}`,
    });

    if (body !== undefined) {
      headers.set("content-type", "application/json");
    }

    const response = await fetcher(new Request(getApiUrl({
      baseUrl,
      path,
      query,
    }), {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
      method,
    }));

    return readCloudflareApiResponse<Result>({
      response,
    });
  };

  const paginate = async function* <Item>(
    options: CloudflareApiRequestOptions,
  ): AsyncGenerator<Item> {
    let page = 1;

    while (true) {
      const response = await request<Item[]>({
        ...options,
        query: {
          ...options.query,
          page,
        },
      });

      yield* response.result;

      if (!response.result_info || page >= response.result_info.total_pages) {
        return;
      }

      page += 1;
    }
  };

  return {
    paginate,
    request,
  };
}

/** One entry of `GET /accounts/{account_id}/workers/domains`. */
interface CloudflareWorkersDomain {
  hostname?: string;
  service?: string;
  zone_id?: string;
  zone_name?: string;
}

interface CachePurgeConfig {
  apiToken: string;
  zoneId: string;
}

function getTrimmedEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

/** Absent outside the Workers runtime (unit tests, tooling), where the cache is simply skipped. */
function getWorkerZoneIdCache(): KVNamespace | null {
  return workerEnv.KV_STORE ?? null;
}

async function readCachedWorkerZoneId(): Promise<string | null> {
  try {
    return (await getWorkerZoneIdCache()?.get(WORKER_ZONE_ID_CACHE_KEY)) ?? null;
  } catch {
    // A cache that cannot be read is a cold cache: the API lookup below still answers.
    return null;
  }
}

async function writeCachedWorkerZoneId(zoneId: string): Promise<void> {
  try {
    await getWorkerZoneIdCache()?.put(WORKER_ZONE_ID_CACHE_KEY, zoneId, {
      expirationTtl: WORKER_ZONE_ID_CACHE_TTL_SECONDS,
    });
  } catch {
    // Never fail the purge that triggered the lookup; the next isolate retries the API call.
  }
}

/**
 * Reads the account's Workers domains for the zone that serves `SITE_DOMAIN`. That listing needs
 * only the account-scoped `Workers Scripts:Read` the deploy token already carries, so no separate
 * zone id has to be configured.
 */
async function fetchWorkerZoneId(): Promise<string> {
  const accountId = getTrimmedEnvValue(workerEnv.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = getTrimmedEnvValue(workerEnv.CLOUDFLARE_API_TOKEN);

  if (!accountId || !apiToken) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required to resolve the zone.");
  }

  const response = await getCloudflareApiClient({ apiToken }).request<CloudflareWorkersDomain[]>({
    path: `/accounts/${accountId}/workers/domains`,
    query: { hostname: SITE_DOMAIN },
  });
  const zoneId = response.result?.find((domain) => domain.zone_id)?.zone_id;

  if (!zoneId) {
    throw new Error(`No Cloudflare zone is attached to ${SITE_DOMAIN}.`);
  }

  return zoneId;
}

/**
 * The zone that serves this Worker: this isolate's memo, then KV, then the API. A failed lookup
 * throws, so `lazyValue` never memoizes it and only a real hit is ever written back.
 */
const getLookedUpWorkerZoneId = lazyValue(async (): Promise<string> => {
  const cached = await readCachedWorkerZoneId();

  if (cached) {
    return cached;
  }

  const zoneId = await fetchWorkerZoneId();

  await writeCachedWorkerZoneId(zoneId);

  return zoneId;
});

/** The configured override, else the looked-up zone. `null` when neither can be determined. */
// fallow-ignore-next-line unused-export -- Exported for its unit tests; `getCachePurgeConfig` is the caller.
export async function getWorkerZoneId(): Promise<string | null> {
  const configuredZoneId = getTrimmedEnvValue(workerEnv.CLOUDFLARE_ZONE_ID);

  if (configuredZoneId) {
    return configuredZoneId;
  }

  try {
    return await getLookedUpWorkerZoneId();
  } catch {
    // An unavailable zone is a configuration answer, not a failure: the caller hides the feature.
    return null;
  }
}

/** Everything a zone purge needs, or `null` when this Worker cannot perform one. */
export async function getCachePurgeConfig(): Promise<CachePurgeConfig | null> {
  const apiToken = getTrimmedEnvValue(workerEnv.CLOUDFLARE_API_TOKEN);

  if (!apiToken) {
    return null;
  }

  const zoneId = await getWorkerZoneId();

  return zoneId ? { apiToken, zoneId } : null;
}

/**
 * The runtime twin of the deploy workflow's purge step: `purge_everything` on the whole zone.
 * Throws a `CloudflareApiError` when the API answers `success: false`.
 */
export async function purgeZoneCacheEverything({
  apiToken,
  zoneId,
}: CachePurgeConfig): Promise<{ purgeId: string | null }> {
  const response = await getCloudflareApiClient({ apiToken }).request<
    { id?: string } | null,
    { purge_everything: boolean }
  >({
    method: "POST",
    path: `/zones/${zoneId}/purge_cache`,
    body: { purge_everything: true },
  });

  return { purgeId: response.result?.id ?? null };
}

/**
 * Purge by `Cache-Tag`, which reaches every data center — unlike a `caches.default` delete, which
 * reaches only the colo that ran it.
 *
 * Tags, not URLs. Cloudflare cannot purge a URL that uses a custom cache key set by a Worker, and
 * the stored HTML key is exactly that; tags are the documented way to reach a Cache API entry
 * selectively. Chunked at `ZONE_PURGE_TAGS_PER_REQUEST`. Throws a `CloudflareApiError` when the API
 * answers `success: false`.
 */
export async function purgeZoneCacheTags({
  apiToken,
  tags,
  zoneId,
}: CachePurgeConfig & { tags: string[] }): Promise<void> {
  const client = getCloudflareApiClient({ apiToken });

  for (let index = 0; index < tags.length; index += ZONE_PURGE_TAGS_PER_REQUEST) {
    await client.request<unknown, { tags: string[] }>({
      method: "POST",
      path: `/zones/${zoneId}/purge_cache`,
      body: { tags: tags.slice(index, index + ZONE_PURGE_TAGS_PER_REQUEST) },
    });
  }
}

export function getCloudflareApiClient({
  apiToken,
}: CloudflareApiClientOptions): CloudflareApiClient {
  const trimmedApiToken = apiToken.trim();

  if (!trimmedApiToken) {
    throw new Error("CLOUDFLARE_API_TOKEN is not configured.");
  }

  if (!cachedClient || cachedApiToken !== trimmedApiToken) {
    cachedClient = createCloudflareApiClient({
      apiToken: trimmedApiToken,
    });
    cachedApiToken = trimmedApiToken;
  }

  return cachedClient;
}
