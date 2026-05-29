import "server-only";

const DEFAULT_CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";

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
