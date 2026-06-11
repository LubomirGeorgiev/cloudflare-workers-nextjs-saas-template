import "server-only";
import { checkRateLimit } from "./rate-limit";
import { getIP } from "./get-IP";
import ms from "ms";
import isProd from "./is-prod";
import { isTestMode } from "./is-test-mode";

const UNKNOWN_IP_RATE_LIMIT_KEY = "unknown-ip";

interface RateLimitConfig {
  /**
   * The key to use for the rate limit. Usually an IP address or a user ID.
   * @default IP address of the request
   */
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
}

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60);

    super(`Rate limit exceeded. Try again in ${retryAfterMinutes} minutes.`);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function withRateLimit<T>(
  action: () => Promise<T>,
  config: RateLimitConfig
): Promise<T> {
  if (!isProd || isTestMode()) {
    return action();
  }

  const ip = await getIP();
  const key = config.userIdentifier || ip || UNKNOWN_IP_RATE_LIMIT_KEY;

  if (!config.userIdentifier && !ip) {
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

  if (!rateLimitResult.success) {
    throw new RateLimitError(
      Math.max(0, Math.ceil(rateLimitResult.reset - Date.now() / 1000))
    );
  }

  return action();
}

// Common rate limit configurations
export const RATE_LIMITS = {
  SIGN_IN: {
    identifier: "sign-in",
    limit: 15,
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
    limit: 15,
    windowInSeconds: Math.floor(ms("5 minutes") / 1000),
  },
  PURCHASE: {
    identifier: "purchase",
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
} as const;
