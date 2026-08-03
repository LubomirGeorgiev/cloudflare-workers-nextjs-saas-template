import "server-only";
import { checkRateLimit, resetRateLimit } from "./rate-limit";
import { getIP } from "./get-IP";
import ms from "ms";
import isProd from "./is-prod";
import { isTestMode } from "./is-test-mode";

const UNKNOWN_IP_RATE_LIMIT_KEY = "unknown-ip";

export interface RateLimitConfig {
  userIdentifier?: string;
  /**
   * A unique identifier for the rate limit.
   */
  identifier: string;
  /**
   * The maximum number of requests allowed within the window.
   */
  limit: number;
  /**
   * The time window in seconds.
   */
  windowInSeconds: number;
  /**
   * Persist successful counter writes after returning the response. Use only for soft, low-risk limits.
   */
  deferWrite?: boolean;
  /**
   * Clear this bucket after the wrapped action succeeds so only failed attempts consume it.
   * Intended for account-keyed sign-in limits; do not combine with `deferWrite`.
   */
  resetOnSuccess?: boolean;
}

// Common rate limit configurations
export const RATE_LIMITS = {
  SIGN_IN: {
    identifier: "sign-in",
    limit: 15,
    windowInSeconds: Math.floor(ms("60 minutes") / 1000),
  },
  SIGN_IN_ACCOUNT: {
    identifier: "sign-in-account",
    limit: 10,
    windowInSeconds: Math.floor(ms("60 minutes") / 1000),
  },
  GOOGLE_SSO_REQUEST: {
    identifier: "google-sso-request",
    limit: 15,
    windowInSeconds: Math.floor(ms("60 minutes") / 1000),
  },
  GOOGLE_SSO_CALLBACK: {
    identifier: "google-sso-callback",
    limit: 15,
    windowInSeconds: Math.floor(ms("60 minutes") / 1000),
  },
  SIGN_UP: {
    identifier: "sign-up",
    limit: 3,
    windowInSeconds: Math.floor(ms("1 hour") / 1000),
  },
  SIGN_OUT: {
    identifier: "sign-out",
    limit: 5,
    windowInSeconds: Math.floor(ms("10 minutes") / 1000),
  },
  RESET_PASSWORD: {
    identifier: "auth",
    limit: 7,
    windowInSeconds: Math.floor(ms("1 hour") / 1000),
  },
  DELETE_SESSION: {
    identifier: "delete-session",
    limit: 10,
    windowInSeconds: Math.floor(ms("10 minutes") / 1000),
  },
  EMAIL: {
    identifier: "email",
    limit: 10,
    windowInSeconds: Math.floor(ms("1 hour") / 1000),
  },
  FORGOT_PASSWORD: {
    identifier: "forgot-password",
    limit: 4,
    windowInSeconds: Math.floor(ms("1 hour") / 1000),
  },
  SETTINGS: {
    identifier: "settings",
    limit: 30,
    windowInSeconds: Math.floor(ms("1 minute") / 1000),
  },
  BILLING: {
    identifier: "billing",
    limit: 25,
    windowInSeconds: Math.floor(ms("5 minutes") / 1000),
  },
  TEAM_INVITE: {
    identifier: "team-invite",
    limit: 5,
    windowInSeconds: Math.floor(ms("1 hour") / 1000),
  },
  UPLOAD: {
    identifier: "upload",
    limit: 30,
    windowInSeconds: Math.floor(ms("5 minutes") / 1000),
  },
  CMS_MARKDOWN_API: {
    identifier: "cms-markdown-api",
    limit: 5,
    windowInSeconds: Math.floor(ms("1 minute") / 1000),
  },
  GET_SESSION_API: {
    identifier: "get-session-api",
    limit: 50,
    windowInSeconds: Math.floor(ms("1 minute") / 1000),
    deferWrite: true,
  },
  CMS_IMAGES_API: {
    identifier: "cms-images-api",
    limit: 300,
    windowInSeconds: Math.floor(ms("1 minute") / 1000),
  },
  DOCS_SEARCH: {
    identifier: "docs-search",
    limit: 20,
    windowInSeconds: Math.floor(ms("1 minute") / 1000),
  },
  // Public API, keyed by the credential rather than the user: one leaked key cannot
  // exhaust the owner's other keys.
  API_AUTHED: {
    identifier: "api-authed",
    limit: 300,
    windowInSeconds: Math.floor(ms("1 minute") / 1000),
  },
  // Charged only when a request fails to authenticate, so credential spraying is bounded
  // by IP without touching legitimate traffic.
  API_ANON: {
    identifier: "api-anon",
    limit: 20,
    windowInSeconds: Math.floor(ms("1 minute") / 1000),
  },
  // Open DCR is intentionally public, but registrations allocate provider and D1 records.
  // Keep a separate per-IP budget so forks can tune it without changing API traffic limits.
  OAUTH_DCR: {
    identifier: "oauth-dcr",
    limit: 10,
    windowInSeconds: Math.floor(ms("1 hour") / 1000),
  },
  // Token issuance creates provider KV records. Bound it independently from API traffic so a
  // valid authorization code or refresh token cannot be used for unbounded record churn.
  OAUTH_TOKEN_IP: {
    identifier: "oauth-token-ip",
    // Deliberately broad: hosted agent platforms can send many users through shared egress.
    limit: 1_200,
    windowInSeconds: Math.floor(ms("1 minute") / 1000),
  },
  // Stable across authorization-code exchange and refresh-token rotation. This is the useful
  // record-churn ceiling; the broader IP bucket only catches identity spraying.
  OAUTH_TOKEN_IDENTITY: {
    identifier: "oauth-token-identity",
    limit: 30,
    windowInSeconds: Math.floor(ms("1 minute") / 1000),
  },
} as const;

/** What a charged bucket has left, in the terms the `RateLimit-*` response headers state it. */
export interface RateLimitSnapshot {
  limit: number;
  remaining: number;
  /** Seconds until the current window resets. */
  resetSeconds: number;
  /** The window the limit applies over, for the quota-policy parameter. */
  windowInSeconds: number;
}

// `message` is log-only; `actionClient`'s `handleServerError` builds the
// localized user-facing copy from `retryAfterSeconds`.
export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  /** The exhausted bucket, so a 429 can describe it with the same headers a 200 carries. */
  readonly quota?: RateLimitSnapshot;

  constructor(retryAfterSeconds: number, quota?: RateLimitSnapshot) {
    super(`Rate limit exceeded. Try again in ${retryAfterSeconds}s.`);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
    this.quota = quota;
  }
}

// Charges one request against the bucket and throws once it is exhausted. Returns the resolved key
// as well, because a refund (`resetOnSuccess`) has to address the very bucket that was charged.
async function chargeBucket(
  config: RateLimitConfig
): Promise<{ key: string; quota: RateLimitSnapshot }> {
  // Normalize a falsy identifier to undefined so an empty string can't collapse every
  // request into one shared bucket or skip the IP fallback.
  const userIdentifier = config.userIdentifier || undefined;

  const ip = userIdentifier === undefined ? await getIP() : undefined;
  const key = userIdentifier ?? ip ?? UNKNOWN_IP_RATE_LIMIT_KEY;

  if (!userIdentifier && !ip) {
    console.warn(
      `Rate limit "${config.identifier}" used ${UNKNOWN_IP_RATE_LIMIT_KEY} because the trusted client IP header was unavailable.`
    );
  }

  const rateLimitResult = await checkRateLimit({
    key,
    options: {
      identifier: config.identifier,
      limit: config.limit,
      windowInSeconds: config.windowInSeconds,
      deferWrite: config.deferWrite,
    },
  });

  const quota: RateLimitSnapshot = {
    limit: rateLimitResult.limit,
    remaining: Math.max(0, rateLimitResult.remaining),
    resetSeconds: Math.max(0, Math.ceil(rateLimitResult.reset - Date.now() / 1000)),
    windowInSeconds: config.windowInSeconds,
  };

  if (!rateLimitResult.success) {
    throw new RateLimitError(quota.resetSeconds, quota);
  }

  return { key, quota };
}

/**
 * Charge a bucket without wrapping any work, and report what the window has left so the caller can
 * publish it as headers. Null when throttling is bypassed (non-prod or test mode): a client must
 * not be handed a quota that nothing is enforcing.
 */
export async function consumeRateLimit(
  config: RateLimitConfig
): Promise<RateLimitSnapshot | null> {
  if (!isProd || isTestMode()) {
    return null;
  }

  return (await chargeBucket(config)).quota;
}

export async function withRateLimit<T>(
  action: () => Promise<T>,
  config: RateLimitConfig
): Promise<T> {
  if (!isProd || isTestMode()) {
    return action();
  }

  const { key } = await chargeBucket(config);

  const result = await action();

  // The counter was incremented before the action ran; refund it on success so only
  // failed attempts consume the bucket. A failed reset must never fail the request.
  if (config.resetOnSuccess) {
    try {
      await resetRateLimit({
        key,
        identifier: config.identifier,
        windowInSeconds: config.windowInSeconds,
      });
    } catch (error) {
      console.error(
        `Failed to reset rate limit "${config.identifier}" after a successful attempt.`,
        error
      );
    }
  }

  return result;
}
